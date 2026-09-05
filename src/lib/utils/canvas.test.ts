import { describe, expect, it } from 'vitest';
import {
	canvasContext,
	shouldApplyNoteEvent,
	titleFor,
	withCanvasContext,
	worthOpening
} from './canvas';

describe('naming a document after the answer it came from', () => {
	it('uses a heading as its words', () => {
		expect(titleFor('# Deployment checklist\n\nFirst, ...')).toBe('Deployment checklist');
	});

	it('uses the first line when there is no heading', () => {
		expect(titleFor('Here is the plan.\n\nStep one...')).toBe('Here is the plan.');
	});

	it('sees through emphasis', () => {
		expect(titleFor('**Migration plan**')).toBe('Migration plan');
	});

	it('skips leading blank lines', () => {
		expect(titleFor('\n\n\nThe actual title')).toBe('The actual title');
	});

	it('shortens a line too long to be a title', () => {
		const title = titleFor('x'.repeat(200));
		expect(title.length).toBeLessThanOrEqual(60);
		expect(title.endsWith('…')).toBe(true);
	});

	it('falls back when there is nothing to name it after', () => {
		expect(titleFor('')).toBe('Untitled');
		expect(titleFor('   \n  ', 'Draft')).toBe('Draft');
	});
});

describe('telling the model which document is open', () => {
	it('names the note and its id', () => {
		const context = canvasContext({ id: 'abc123', title: 'Deployment checklist' });
		expect(context).toContain('abc123');
		expect(context).toContain('Deployment checklist');
	});

	it('names the tools that read and change it', () => {
		const context = canvasContext({ id: 'abc123' });
		expect(context).toContain('view_note');
		expect(context).toContain('replace_note_content');
	});

	it('does not paste the document into every message', () => {
		// The failure this exists for: a long document would cost its own length
		// in tokens on every turn, and be stale the moment either side edited it.
		const context = canvasContext({ id: 'abc123', title: 'Notes' });
		expect(context.length).toBeLessThan(500);
	});

	it('passes on a selected passage when there is one', () => {
		const context = canvasContext({ id: 'abc', title: 'T' }, '  the second paragraph  ');
		expect(context).toContain('the second paragraph');
	});

	it('says nothing about a selection when there is none', () => {
		expect(canvasContext({ id: 'abc' }, '   ')).not.toContain('selected');
	});

	it('says nothing at all when no document is open', () => {
		expect(canvasContext(null)).toBe('');
		expect(canvasContext({ id: '' })).toBe('');
	});

	it('leaves a prompt untouched when no document is open', () => {
		expect(withCanvasContext('hello', null)).toBe('hello');
	});

	it('appends to a prompt when one is open', () => {
		const prompt = withCanvasContext('tighten the second paragraph', { id: 'n1', title: 'Plan' });
		expect(prompt.startsWith('tighten the second paragraph')).toBe(true);
		expect(prompt).toContain('n1');
	});
});

describe('deciding whether an announced change should be applied', () => {
	const mine = { id: 'n1', updated_at: 100 };

	it('applies a newer version of the same note', () => {
		expect(shouldApplyNoteEvent(mine, { id: 'n1', updated_at: 200 })).toBe(true);
	});

	it('applies a version with the same timestamp', () => {
		// The server writes and announces in the same second often enough that
		// requiring strictly newer would drop the model's edit.
		expect(shouldApplyNoteEvent(mine, { id: 'n1', updated_at: 100 })).toBe(true);
	});

	it('ignores an older version', () => {
		// The failure this exists for: every write comes back as an event,
		// including the reader's own, and a late one would undo what follows it.
		expect(shouldApplyNoteEvent(mine, { id: 'n1', updated_at: 50 })).toBe(false);
	});

	it('ignores a different note entirely', () => {
		expect(shouldApplyNoteEvent(mine, { id: 'other', updated_at: 999 })).toBe(false);
	});

	it('waits while the reader is still typing', () => {
		// Replacing the document mid-sentence takes the cursor with it.
		expect(shouldApplyNoteEvent(mine, { id: 'n1', updated_at: 200 }, 5_000, 1_000)).toBe(false);
	});

	it('applies once they have stopped', () => {
		expect(shouldApplyNoteEvent(mine, { id: 'n1', updated_at: 200 }, 5_000, 6_000)).toBe(true);
	});

	it('accepts the first note when nothing is open yet', () => {
		expect(shouldApplyNoteEvent(null, { id: 'n1', updated_at: 1 })).toBe(true);
	});

	it('ignores an event with no note in it', () => {
		expect(shouldApplyNoteEvent(mine, null)).toBe(false);
		expect(shouldApplyNoteEvent(mine, { updated_at: 999 })).toBe(false);
	});
});

describe('deciding what is worth opening', () => {
	it('offers a document for a long answer', () => {
		expect(worthOpening('a'.repeat(400))).toBe(true);
	});

	it('does not offer one for a one-line reply', () => {
		// Otherwise the action is noise on every message in the conversation.
		expect(worthOpening('Yes, that works.')).toBe(false);
	});

	it('ignores surrounding whitespace', () => {
		expect(worthOpening(`   ${'a'.repeat(190)}   `, 200)).toBe(false);
	});

	it('survives an empty answer', () => {
		expect(worthOpening('')).toBe(false);
	});
});
