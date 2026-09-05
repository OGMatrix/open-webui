/**
 * Deciding whether the view is still following the conversation.
 *
 * The chat pane re-attaches to the newest message when the reader is at the
 * bottom, and "at the bottom" needs slack. Without it the test is unwinnable
 * while an answer streams: every token appended moves the bottom away before
 * the next scroll event fires, so a reader who scrolls down by hand lands a few
 * pixels short and the view never follows again. The check that governed this
 * allowed five pixels; every other check in the same pane allowed fifty.
 */

/**
 * How far from the bottom still counts as being at it.
 *
 * Fifty is what the rest of the pane already used, and it is small enough that
 * deliberately scrolling up to re-read something does not read as staying put.
 */
export const NEAR_BOTTOM_SLACK = 50;

type Scrollable = {
	scrollHeight?: number;
	scrollTop?: number;
	clientHeight?: number;
};

/** Whether a scrollable element is at, or close enough to, its end. */
export const isNearBottom = (element: Scrollable | null | undefined, slack = NEAR_BOTTOM_SLACK) => {
	if (!element) {
		return false;
	}
	const { scrollHeight = 0, scrollTop = 0, clientHeight = 0 } = element;
	return scrollHeight - scrollTop <= clientHeight + slack;
};
