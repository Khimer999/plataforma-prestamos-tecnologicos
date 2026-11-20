import assert from 'node:assert/strict';
import test from 'node:test';
import { hasCapacity, validatePeriod } from '../reglas.mjs';

const row = (fechaInicio, fechaFin) => ({ fechaInicio, fechaFin });

test('la ocupación se calcula por unidades simultáneas y permite franjas consecutivas', () => {
    const build = (stock, reservations) => ({ start: 10, end: 30, stock, reservations });
    assert.equal(hasCapacity(build(1, [row(0, 10), row(30, 40)])), true);
    assert.equal(hasCapacity(build(1, [row(11, 12)])), false);
    assert.equal(hasCapacity(build(2, [row(10, 15), row(15, 30)])), true);
    assert.equal(hasCapacity(build(2, [row(10, 17), row(15, 30)])), false);
    assert.equal(hasCapacity(build(0, [])), false);
});

test('valida fechas de calendario, zona y plazo máximo exacto', () => {
    const now = Date.parse('2027-03-01T00:00:00Z');
    assert.deepEqual(validatePeriod('2027-03-01T15:30-05:00', '2027-03-04T15:30-05:00', now).map((date) => date.toISOString()),
        ['2027-03-01T20:30:00.000Z', '2027-03-04T20:30:00.000Z']);
    assert.throws(() => validatePeriod('2027-03-01T15:30-05:00', '2027-03-04T15:31-05:00', now), /72 horas/);
    assert.throws(() => validatePeriod('2027-02-30T07:00Z', '2027-03-04T15:30-05:00', now), /fechas válidas/);
    assert.throws(() => validatePeriod('2027-03-01T07:00', '2027-03-04T15:30-05:00', now), /zona horaria/);
});
