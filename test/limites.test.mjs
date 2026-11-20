import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAdmission, readLimits } from '../limites.mjs';

test('mantiene un máximo de operaciones activas y una cola acotada en orden de llegada', async () => {
    const admit = createAdmission({ workers: 1, queueLimit: 2, waitMs: 1000 });
    const order = [];
    let finish;
    const first = admit(undefined, () => new Promise((resolve) => {
        order.push(1);
        finish = resolve;
    }));
    await firstStarted();
    const second = admit(undefined, () => { order.push(2); });
    const third = admit(undefined, () => { order.push(3); });
    await assert.rejects(admit(undefined, () => { order.push(4); }), { status: 503 });
    assert.deepEqual(order, [1]);
    finish();
    await Promise.all([first, second, third]);
    assert.deepEqual(order, [1, 2, 3]);
});

test('retira una solicitud desconectada y otra vencida sin ejecutar sus escrituras', async () => {
    const admit = createAdmission({ workers: 1, queueLimit: 1, waitMs: 20 });
    let finish;
    const blocker = admit(undefined, () => new Promise((resolve) => { finish = resolve; }));
    await firstStarted();
    const client = new AbortController();
    const unwanted = () => assert.fail('La solicitud cancelada no debe ejecutarse');
    const canceled = assert.rejects(admit(client.signal, unwanted), { name: 'AbortError' });
    client.abort();
    await canceled;
    await assert.rejects(admit(undefined, unwanted), { status: 503 });
    finish();
    await blocker;
    assert.equal(await admit(undefined, () => 13), 13);
});

test('recupera capacidad si falla una operación', async () => {
    const admit = createAdmission({ workers: 1, queueLimit: 1, waitMs: 100 });
    await assert.rejects(admit(undefined, () => { throw new Error('falló la operación'); }), /falló la operación/);
    assert.equal(await admit(undefined, () => 42), 42);
});

test('valida la configuración de capacidad', () => {
    assert.equal(readLimits({ DB_POOL_SIZE: '24' }).poolSize, 24);
    assert.equal(readLimits({}).authWorkers, 4);
    assert.throws(() => readLimits({ DB_QUEUE_LIMIT: 'infinito' }), /DB_QUEUE_LIMIT/);
});

function firstStarted() {
    return new Promise((resolve) => setImmediate(resolve));
}
