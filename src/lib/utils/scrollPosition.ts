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

/**
 * Whether a growing pane should be pulled back to its end.
 *
 * Following a streaming answer is not the same question as being at the bottom.
 * The pane grows between frames, so by the time the growth is measured the
 * reader is already a little short of the end through no act of their own --
 * and the amount they are short by is exactly how much arrived. Anything up to
 * that, plus the usual slack, is still following.
 *
 * Scrolling up by hand is what stops it, and that is the one case this must not
 * swallow: a reader who moved further than the content grew has left.
 */
export const shouldFollow = (
	element: Scrollable | null | undefined,
	/** How much taller the pane became since it was last measured. */
	grewBy = 0,
	slack = NEAR_BOTTOM_SLACK
) => isNearBottom(element, slack + Math.max(0, grewBy));
