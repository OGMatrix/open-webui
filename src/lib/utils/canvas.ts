import { markdownToText } from './chatSearch';

/**
 * A canvas is a note held open beside a conversation.
 *
 * Everything needed to edit one already exists: notes store markdown, the
 * model has `view_note` and `replace_note_content` -- which takes ranges, not
 * just whole documents -- and the server announces every change on a socket.
 * What was missing was a way to get from an answer to a document at all: the
 * bridge ran one way, from the notes page into a chat embedded in it.
 *
 * This module holds the parts of that bridge which can be wrong on their own:
 * naming a document after the answer it came from, telling the model which
 * document is open, and deciding whether an announced change should overwrite
 * what the reader is currently typing.
 */

const TITLE_LIMIT = 60;

/**
 * A name for the document, taken from the answer it was made of.
 *
 * The first line that has anything in it, read as text rather than as
 * markdown, so a heading becomes its words and not a row of hashes.
 */
export const titleFor = (markdown: string, fallback = 'Untitled'): string => {
	const line = markdownToText(markdown ?? '')
		.split('\n')
		.map((part) => part.trim())
		.find((part) => part.length > 0);

	if (!line) return fallback;
	return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT - 1).trimEnd()}…` : line;
};

export interface CanvasNote {
	id: string;
	title?: string;
}

/**
 * What the model is told about the document beside the conversation.
 *
 * The name and the identifier, not the contents. `view_note` can fetch those
 * when they are needed, and pasting a whole document into every message would
 * cost its length in tokens on every turn while going stale the moment either
 * side edited it.
 */
export const canvasContext = (note: CanvasNote | null, selection = ''): string => {
	if (!note?.id) return '';

	const name = (note.title ?? '').trim();
	const lines = [
		`A document is open beside this conversation: note id \`${note.id}\`${name ? ` titled "${name}"` : ''}.`,
		'Read it with view_note and change it with replace_note_content. When the user asks for a change to it, edit the note rather than repeating the whole document back in your reply.'
	];

	const selected = selection.trim();
	if (selected) {
		lines.push(`The user has selected this passage in the document:\n${selected}`);
	}

	return lines.join('\n');
};

/** Append the canvas context to a prompt, or leave the prompt alone. */
export const withCanvasContext = (
	prompt: string,
	note: CanvasNote | null,
	selection = ''
): string => {
	const context = canvasContext(note, selection);
	return context ? `${prompt}\n\n${context}` : prompt;
};

export interface NoteLike {
	id?: string;
	updated_at?: number | null;
}

/**
 * Whether a change announced by the server should replace what is on screen.
 *
 * Two ways to get this wrong. Applying an event for a different note swaps the
 * document under the reader; applying one that is older than what they have
 * undoes edits they just made, because the server announces every write and
 * the reader's own writes come back to them.
 */
export const shouldApplyNoteEvent = (
	current: NoteLike | null,
	incoming: NoteLike | null,
	/** When the reader last typed, so a change mid-edit does not fight them. */
	editingUntil = 0,
	now = Date.now()
): boolean => {
	if (!incoming?.id) return false;
	if (!current?.id) return true;
	if (incoming.id !== current.id) return false;

	// Still typing: an incoming version would take the cursor with it.
	if (editingUntil > now) return false;

	const theirs = incoming.updated_at ?? 0;
	const ours = current.updated_at ?? 0;
	return theirs >= ours;
};

/**
 * Whether an answer is worth offering as a document.
 *
 * A one-line reply is not a document, and offering to open one turns a useful
 * action into noise on every message in the conversation.
 */
export const worthOpening = (content: string, minimum = 200): boolean =>
	(content ?? '').trim().length >= minimum;
