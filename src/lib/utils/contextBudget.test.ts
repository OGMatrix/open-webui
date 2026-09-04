import { describe, expect, it } from 'vitest';
import { RETENTION_RATIO, TRIGGER_RATIO, compactionTrigger, resolveBudget } from './contextBudget';

/**
 * Produced by the server's own budget maths
 * (backend/open_webui/utils/context_budget.py). They are here so the interface
 * cannot start promising a compaction the server will not do: the strip above
 * the prompt box says "compacting in about N tokens", and N has to be the
 * server's N.
 *
 * Columns: window, maxOutputTokens, usable, outputReserve, safetyReserve,
 * trigger, target.
 */
const AGREES_WITH_SERVER: [number, number | null, number, number, number, number, number][] = [
	[8192, null, 6759, 1024, 409, 5745, 2703],
	[16384, null, 13517, 2048, 819, 11489, 5406],
	[32768, null, 27034, 4096, 1638, 22978, 10813],
	[131072, null, 120423, 4096, 6553, 102359, 48169],
	[200000, null, 185904, 4096, 10000, 158018, 74361],
	[262144, null, 244941, 4096, 13107, 208199, 97976],
	[1000000, null, 945904, 4096, 50000, 804018, 378361],
	[4096, null, 3328, 512, 256, 2828, 1331],
	[2048, null, 1280, 512, 256, 1088, 512],
	[32768, 8000, 23130, 8000, 1638, 19660, 9252],
	[8192, 100000, 3687, 4096, 409, 3133, 1474],
	[100000, 1, 94999, 1, 5000, 80749, 37999]
];

describe('agreeing with the server', () => {
	it.each(AGREES_WITH_SERVER)(
		'budgets a %i window (max_tokens %s) exactly as the backend does',
		(window, maxOut, usable, outputReserve, safetyReserve, trigger, target) => {
			const budget = resolveBudget(window, maxOut);
			expect(budget).not.toBeNull();
			expect(budget).toMatchObject({
				window,
				usable,
				outputReserve,
				safetyReserve,
				trigger,
				target
			});
		}
	);
});

describe('what the reserves are for', () => {
	it('never spends the whole window', () => {
		const budget = resolveBudget(32768);
		expect(budget!.usable).toBeLessThan(32768);
	});

	it('fires late rather than early', () => {
		// Compacting early costs a model call and the provider's cached prefix.
		const budget = resolveBudget(32768)!;
		expect(budget.trigger / budget.window).toBeGreaterThan(0.6);
		expect(budget.trigger).toBeLessThan(budget.usable);
	});

	it('leaves room to grow after compacting', () => {
		const budget = resolveBudget(32768)!;
		expect(budget.target).toBeLessThan(budget.trigger / 2);
	});

	it('treats a generation limit larger than the window as a setting, not a fact', () => {
		// Reserving it literally would leave nothing to send.
		const budget = resolveBudget(8192, 100000)!;
		expect(budget.outputReserve).toBe(4096);
		expect(budget.usable).toBeGreaterThan(0);
	});

	it('uses the documented ratios', () => {
		const budget = resolveBudget(100000, 1)!;
		expect(budget.trigger).toBe(Math.trunc(budget.usable * TRIGGER_RATIO));
		expect(budget.target).toBe(Math.trunc(budget.usable * RETENTION_RATIO));
	});
});

describe('refusing to guess', () => {
	it.each([null, undefined, 0, -1, NaN, 'lots'])('%s is not a window', (value) => {
		expect(resolveBudget(value as never)).toBeNull();
		expect(compactionTrigger(value as never)).toBeNull();
	});

	it('reads a window that arrived as a string', () => {
		expect(resolveBudget('32768' as never)?.window).toBe(32768);
	});
});

describe('the trigger on its own', () => {
	it('is the budget trigger', () => {
		expect(compactionTrigger(200000)).toBe(158018);
	});

	it('is below the window by a useful margin', () => {
		// The strip warns at 90% of this, so it has to leave enough room that
		// the warning is actionable rather than simultaneous with the event.
		const trigger = compactionTrigger(200000)!;
		expect(200000 - trigger).toBeGreaterThan(10000);
	});
});
