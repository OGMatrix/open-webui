<script lang="ts">
	import { v4 as uuidv4 } from 'uuid';
	import { config, settings, user as _user, mobile, temporaryChatEnabled } from '$lib/stores';
	import { refreshChatList } from '$lib/stores/chatList';
	import { tick, getContext, onMount, onDestroy, createEventDispatcher } from 'svelte';
	const dispatch = createEventDispatcher();

	import { toast } from 'svelte-sonner';
	import { deleteChatMessageById, updateChatById } from '$lib/apis/chats';
	import { copyToClipboard, extractCurlyBraceWords } from '$lib/utils';

	import Message from './Messages/Message.svelte';
	import ContextCompactedMarker from './Messages/ContextCompactedMarker.svelte';
	import ContextCompactingRow from './Messages/ContextCompactingRow.svelte';
	import { isNearBottom, shouldFollow } from '$lib/utils/scrollPosition';
	import Loader from '../common/Loader.svelte';
	import Spinner from '../common/Spinner.svelte';

	import ChatPlaceholder from './ChatPlaceholder.svelte';

	const i18n = getContext('i18n');

	export let className = 'h-full flex pt-18';

	export let chatId = '';
	export let user = $_user;

	export let prompt;
	export let history = {};
	export let selectedModels;
	export let atSelectedModel;

	let messages = [];

	export let setInputText: Function = () => {};

	export let sendMessage: Function;
	export let continueResponse: Function;
	export let regenerateResponse: Function;
	export let mergeResponses: Function;

	export let chatActionHandler: Function;
	export let showMessage: Function = () => {};
	export let submitMessage: Function = () => {};
	export let addMessages: Function = () => {};
	export let onToolCallResolved: Function = () => {};
	export let forkHandler: Function | null = null;

	export let readOnly = false;
	export let allowDelete = true;
	export let compactPreview = false;
	export let editCodeBlock = true;

	export let topPadding = false;
	export let bottomPadding = false;
	export let autoScroll;
	/** Compaction while it runs, so it is seen where it happens. */
	export let contextCompaction: { state: 'running' | 'failed'; startedAt: number } | null = null;
	export let messagesContainerId = 'messages-container';

	/**
	 * The column a message occupies.
	 *
	 * Anything rendered beside a message has to match it, or it sits against the
	 * left edge of the window while the conversation runs down the middle. Kept
	 * in step with the wrapper in Messages/Message.svelte.
	 */
	$: messageColumnClass = `mx-auto w-full px-3.5 ${
		($settings?.widescreenMode ?? null) ? 'max-w-full' : 'max-w-[58rem]'
	}`;

	export let onSelect = (e) => {};
	export let onInsertToNote: ((content: string) => void) | null = null;
	export let onOpenInCanvas: ((content: string) => void) | null = null;

	export let messagesCount: number | null = 8;
	let messagesLoading = false;

	const getMessagesContainer = () => document.getElementById(messagesContainerId);

	onDestroy(() => {
		cancelAnimationFrame(pendingRebuild);
		cancelAnimationFrame(followScheduled);
	});

	const loadMoreMessages = async () => {
		const element = getMessagesContainer();
		const previousScrollHeight = element?.scrollHeight ?? 0;

		messagesLoading = true;
		messagesCount += 8;

		buildMessages();

		await tick();

		if (element) {
			element.scrollTop += element.scrollHeight - previousScrollHeight;
		}

		messagesLoading = false;
	};

	let pendingRebuild = null;
	let lastCurrentId = null;

	const buildMessages = () => {
		let _messages = [];

		let message = history.messages[history.currentId];
		const visitedMessageIds = new Set();

		while (message && (messagesCount !== null ? _messages.length < messagesCount : true)) {
			if (visitedMessageIds.has(message.id)) {
				console.warn('Circular dependency detected in message history', message.id);
				break;
			}
			visitedMessageIds.add(message.id);

			_messages.push(message);
			message = message.parentId !== null ? history.messages[message.parentId] : null;
		}

		messages = _messages.reverse();
	};

	// Throttle message list rebuilds to once per animation frame during streaming.
	// Structural changes (currentId change) always rebuild immediately.
	const handleHistoryChange = (currentId, _messages) => {
		if (!currentId) {
			messages = [];
			return;
		}

		const currentIdChanged = currentId !== lastCurrentId;
		lastCurrentId = currentId;

		if (currentIdChanged) {
			// Structural change: new chat, navigation, new message — rebuild immediately
			cancelAnimationFrame(pendingRebuild);
			pendingRebuild = null;
			buildMessages();
			void followAfterRender();
		} else if (_messages) {
			// Content update (streaming) — throttle to once per frame
			if (!pendingRebuild) {
				pendingRebuild = requestAnimationFrame(() => {
					pendingRebuild = null;
					buildMessages();
					void followAfterRender();
				});
			}
		}
	};

	$: handleHistoryChange(history.currentId, history.messages);

	/**
	 * Keep the view at the end of a growing answer.
	 *
	 * Driven by the list rebuild above, which runs on every change to the
	 * history -- during streaming, every token. An earlier attempt watched an
	 * element for resizes instead and watched the wrong one: the node it
	 * observed carries `h-full`, so its height is the container's height and it
	 * never grows. It fired on window resizes and on nothing else.
	 *
	 * The reader is followed only while they are still at the end. Scrolling up
	 * stops it, and the scroll handler that sets `autoScroll` is what notices.
	 */
	let followScheduled = 0;
	let lastHeight = 0;

	const follow = () => {
		const container = getMessagesContainer();
		if (!container) return;

		const grewBy = container.scrollHeight - lastHeight;
		lastHeight = container.scrollHeight;

		// Between two frames the pane grows by whatever arrived, which leaves the
		// reader short of the end without them having moved. Allowing for that is
		// the difference between following an answer and stopping at its first
		// paragraph.
		if (!autoScroll || !shouldFollow(container, grewBy)) return;
		container.scrollTop = container.scrollHeight;
	};

	/**
	 * Scroll once the tokens that arrived are actually laid out.
	 *
	 * `tick` waits for Svelte to apply the change; the frame after it is where
	 * the browser has measured the result, and measuring before that reads the
	 * height the pane had a moment ago.
	 */
	const followAfterRender = async () => {
		await tick();
		cancelAnimationFrame(followScheduled);
		followScheduled = requestAnimationFrame(follow);
	};

	/**
	 * Content that settles after the last token.
	 *
	 * An image finishing its download makes the pane taller without any change
	 * to the history, so the rebuild never hears about it and the view is left
	 * short of the end. `load` does not bubble, hence the capture phase.
	 */
	const onLateLayout = () => {
		cancelAnimationFrame(followScheduled);
		followScheduled = requestAnimationFrame(follow);
	};

	onMount(() => {
		const container = getMessagesContainer();
		lastHeight = container?.scrollHeight ?? 0;
		container?.addEventListener('load', onLateLayout, true);

		return () => {
			cancelAnimationFrame(followScheduled);
			container?.removeEventListener('load', onLateLayout, true);
		};
	});

	const scrollToBottom = () => {
		const element = getMessagesContainer();
		if (element) {
			element.scrollTop = element.scrollHeight;

			// Follow-up scroll to account for content-visibility: auto re-layouts
			requestAnimationFrame(() => {
				if (element) {
					element.scrollTop = element.scrollHeight;
				}
			});
		}
	};

	/**
	 * Stop paging and put the whole branch on the page.
	 *
	 * Messages arrive eight at a time as the reader scrolls up, so anything
	 * older than the last few is not in the document at all. Searching has to be
	 * able to reach it without asking the reader to scroll for it.
	 */
	export const renderAll = async () => {
		if (messagesCount === null) return;
		messagesCount = null;
		buildMessages();
		await tick();
	};

	export const scrollToTop = async () => {
		messagesCount = null;
		buildMessages();
		await tick();

		const element = getMessagesContainer();
		if (!element) return;

		element.scrollTo({ top: 0, behavior: 'smooth' });
		requestAnimationFrame(() => {
			element.scrollTo({ top: 0, behavior: 'smooth' });
			requestAnimationFrame(() => {
				element.scrollTo({ top: 0, behavior: 'smooth' });
			});
		});
	};

	const updateChat = async () => {
		if (!$temporaryChatEnabled) {
			history = history;
			await tick();
			const res = await updateChatById(localStorage.token, chatId, {
				history: history,
				messages: messages
			});

			// Keep local plain-content edits aligned with the saved chat response.
			if (res?.chat?.history?.messages) {
				for (const [id, msg] of Object.entries(res.chat.history.messages)) {
					if (history.messages[id] && (msg as any).content) {
						history.messages[id].content = (msg as any).content;
					}
				}
				history = history;
			}

			await refreshChatList(localStorage.token);
		}
	};

	const gotoMessage = async (message, idx) => {
		// Determine the correct sibling list (either parent's children or root messages)
		let siblings;
		if (message.parentId !== null) {
			siblings = history.messages[message.parentId].childrenIds;
		} else {
			siblings = Object.values(history.messages)
				.filter((msg) => msg.parentId === null)
				.map((msg) => msg.id);
		}

		// Clamp index to a valid range
		idx = Math.max(0, Math.min(idx, siblings.length - 1));

		let messageId = siblings[idx];

		// If we're navigating to a different message
		if (message.id !== messageId) {
			// Drill down to the deepest child of that branch
			let messageChildrenIds = history.messages[messageId].childrenIds;
			while (messageChildrenIds.length !== 0) {
				messageId = messageChildrenIds.at(-1);
				messageChildrenIds = history.messages[messageId].childrenIds;
			}

			history.currentId = messageId;
		}

		await tick();

		// Optional auto-scroll
		if ($settings?.scrollOnBranchChange ?? true) {
			const element = getMessagesContainer();
			autoScroll = element ? isNearBottom(element) : false;

			setTimeout(() => {
				scrollToBottom();
			}, 100);
		}
	};

	const showPreviousMessage = async (message) => {
		if (message.parentId !== null) {
			let messageId =
				history.messages[message.parentId].childrenIds[
					Math.max(history.messages[message.parentId].childrenIds.indexOf(message.id) - 1, 0)
				];

			if (message.id !== messageId) {
				let messageChildrenIds = history.messages[messageId].childrenIds;

				while (messageChildrenIds.length !== 0) {
					messageId = messageChildrenIds.at(-1);
					messageChildrenIds = history.messages[messageId].childrenIds;
				}

				history.currentId = messageId;
			}
		} else {
			let childrenIds = Object.values(history.messages)
				.filter((message) => message.parentId === null)
				.map((message) => message.id);
			let messageId = childrenIds[Math.max(childrenIds.indexOf(message.id) - 1, 0)];

			if (message.id !== messageId) {
				let messageChildrenIds = history.messages[messageId].childrenIds;

				while (messageChildrenIds.length !== 0) {
					messageId = messageChildrenIds.at(-1);
					messageChildrenIds = history.messages[messageId].childrenIds;
				}

				history.currentId = messageId;
			}
		}

		await tick();

		if ($settings?.scrollOnBranchChange ?? true) {
			const element = getMessagesContainer();
			autoScroll = element ? isNearBottom(element) : false;

			setTimeout(() => {
				scrollToBottom();
			}, 100);
		}
	};

	const showNextMessage = async (message) => {
		if (message.parentId !== null) {
			let messageId =
				history.messages[message.parentId].childrenIds[
					Math.min(
						history.messages[message.parentId].childrenIds.indexOf(message.id) + 1,
						history.messages[message.parentId].childrenIds.length - 1
					)
				];

			if (message.id !== messageId) {
				let messageChildrenIds = history.messages[messageId].childrenIds;

				while (messageChildrenIds.length !== 0) {
					messageId = messageChildrenIds.at(-1);
					messageChildrenIds = history.messages[messageId].childrenIds;
				}

				history.currentId = messageId;
			}
		} else {
			let childrenIds = Object.values(history.messages)
				.filter((message) => message.parentId === null)
				.map((message) => message.id);
			let messageId =
				childrenIds[Math.min(childrenIds.indexOf(message.id) + 1, childrenIds.length - 1)];

			if (message.id !== messageId) {
				let messageChildrenIds = history.messages[messageId].childrenIds;

				while (messageChildrenIds.length !== 0) {
					messageId = messageChildrenIds.at(-1);
					messageChildrenIds = history.messages[messageId].childrenIds;
				}

				history.currentId = messageId;
			}
		}

		await tick();

		if ($settings?.scrollOnBranchChange ?? true) {
			const element = getMessagesContainer();
			autoScroll = element ? isNearBottom(element) : false;

			setTimeout(() => {
				scrollToBottom();
			}, 100);
		}
	};

	const rateMessage = async (messageId, rating) => {
		history.messages[messageId].annotation = {
			...history.messages[messageId].annotation,
			rating: rating
		};

		await updateChat();
	};

	const editMessage = async (messageId, { content, files, output = undefined }, submit = true) => {
		if ((selectedModels ?? []).filter((id) => id).length === 0) {
			toast.error($i18n.t('Model not selected'));
			return;
		}
		if (history.messages[messageId].role === 'user') {
			if (submit) {
				// New user message
				let userPrompt = content;
				let userMessageId = uuidv4();

				let userMessage = {
					id: userMessageId,
					parentId: history.messages[messageId].parentId,
					childrenIds: [],
					role: 'user',
					content: userPrompt,
					...(files && { files: files }),
					models: selectedModels,
					timestamp: Math.floor(Date.now() / 1000) // Unix epoch
				};

				let messageParentId = history.messages[messageId].parentId;

				if (messageParentId !== null) {
					history.messages[messageParentId].childrenIds = [
						...history.messages[messageParentId].childrenIds,
						userMessageId
					];
				}

				history.messages[userMessageId] = userMessage;
				history.currentId = userMessageId;

				await tick();
				await sendMessage(history, userMessageId);
			} else {
				// Edit user message
				history.messages[messageId].content = content;
				history.messages[messageId].files = files;
				await updateChat();
			}
		} else {
			if (submit) {
				// New response message (Save As Copy)
				const responseMessageId = uuidv4();
				const message = history.messages[messageId];
				const parentId = message.parentId;

				const responseMessage = {
					...message,
					id: responseMessageId,
					parentId: parentId,
					childrenIds: [],
					files: undefined,
					content: output !== undefined ? '' : content,
					...(output !== undefined ? { output } : {}),
					timestamp: Math.floor(Date.now() / 1000) // Unix epoch
				};

				history.messages[responseMessageId] = responseMessage;
				history.currentId = responseMessageId;

				// Append messageId to childrenIds of parent message
				if (parentId !== null) {
					history.messages[parentId].childrenIds = [
						...history.messages[parentId].childrenIds,
						responseMessageId
					];
				}

				await updateChat();
			} else {
				// Edit response message
				if (content !== undefined) {
					history.messages[messageId].originalContent = history.messages[messageId].content;
					history.messages[messageId].content = content;
				}
				if (output !== undefined) {
					history.messages[messageId].output = output;
					history.messages[messageId].content = '';
				}
				await updateChat();
			}
		}
	};

	const actionMessage = async (actionId, message, event = null) => {
		await chatActionHandler(chatId, actionId, message.model, message.id, event);
	};

	const saveMessage = async (messageId, message) => {
		if (!history.messages?.[messageId]) {
			return;
		}

		history.messages[messageId] = message;
		await updateChat();
	};

	const deleteMessage = async (messageId) => {
		const messageToDelete = history.messages[messageId];
		const parentMessageId = messageToDelete.parentId;
		const childMessageIds = messageToDelete.childrenIds ?? [];

		// Collect all grandchildren
		const grandchildrenIds = childMessageIds.flatMap(
			(childId) => history.messages[childId]?.childrenIds ?? []
		);

		// Update parent's children
		if (parentMessageId && history.messages[parentMessageId]) {
			history.messages[parentMessageId].childrenIds = [
				...history.messages[parentMessageId].childrenIds.filter((id) => id !== messageId),
				...grandchildrenIds
			];
		}

		// Update grandchildren's parent
		grandchildrenIds.forEach((grandchildId) => {
			if (history.messages[grandchildId]) {
				history.messages[grandchildId].parentId = parentMessageId;
			}
		});

		// Delete the message and its children
		[messageId, ...childMessageIds].forEach((id) => {
			delete history.messages[id];
		});

		let nextMessageId = parentMessageId;
		let nextChildrenIds =
			nextMessageId === null
				? Object.keys(history.messages).filter((id) => history.messages[id].parentId === null)
				: (history.messages[nextMessageId]?.childrenIds ?? []);
		while (nextChildrenIds.length > 0) {
			nextMessageId = nextChildrenIds.at(-1);
			nextChildrenIds = history.messages[nextMessageId]?.childrenIds ?? [];
		}
		history.currentId = nextMessageId;
		history = history;

		if (!$temporaryChatEnabled) {
			const res = await deleteChatMessageById(localStorage.token, chatId, messageId);
			if (res?.chat?.history) {
				history = res.chat.history;
			}

			await refreshChatList(localStorage.token);
		}
	};

	const triggerScroll = () => {
		if (autoScroll) {
			const element = getMessagesContainer();
			if (element) {
				autoScroll = isNearBottom(element);
				setTimeout(() => {
					scrollToBottom();
				}, 100);
			}
		}
	};
</script>

<div class={className}>
	{#if Object.keys(history?.messages ?? {}).length == 0}
		<ChatPlaceholder modelIds={selectedModels} {atSelectedModel} {onSelect} />
	{:else}
		<div class="w-full pt-2">
			{#key chatId}
				<section class="w-full" aria-labelledby="chat-conversation">
					<h2 class="sr-only" id="chat-conversation">{$i18n.t('Chat Conversation')}</h2>
					{#if messages.at(0)?.parentId !== null}
						<Loader
							on:visible={(e) => {
								if (!messagesLoading) {
									loadMoreMessages();
								}
							}}
						>
							<div class="w-full flex justify-center py-1 text-xs animate-pulse items-center gap-2">
								<Spinner className=" size-4" />
								<div class=" ">{$i18n.t('Loading...')}</div>
							</div>
						</Loader>
					{/if}
					<ul role="log" aria-live="polite" aria-relevant="additions" aria-atomic="false">
						{#each messages as message, messageIdx (message.id)}
							{#if message?.contextSummary ?? message?.context_summary}
								<!--
									Where the history above this point was replaced by a note.
									Compaction is otherwise invisible: the chat stops remembering
									things it was told and nothing says why.
								-->
								<div class={messageColumnClass}>
									<ContextCompactedMarker
										id={message.id}
										summary={message.contextSummary ?? message.context_summary}
										detail={message.contextCompaction ?? null}
									/>
								</div>
							{/if}
							<Message
								{chatId}
								bind:history
								{selectedModels}
								messageId={message.id}
								idx={messageIdx}
								{user}
								{setInputText}
								{gotoMessage}
								{showPreviousMessage}
								{showNextMessage}
								{updateChat}
								{editMessage}
								{deleteMessage}
								{rateMessage}
								{actionMessage}
								{saveMessage}
								{submitMessage}
								{regenerateResponse}
								{continueResponse}
								{mergeResponses}
								{addMessages}
								{onToolCallResolved}
								{forkHandler}
								{allowDelete}
								{triggerScroll}
								{readOnly}
								{compactPreview}
								{editCodeBlock}
								{topPadding}
								{onInsertToNote}
								{onOpenInCanvas}
							/>
						{/each}
					</ul>

					{#if contextCompaction}
						<!--
							Where the row will be once it finishes: the finished marker
							replaces this one in place, built alike so nothing jumps.
						-->
						<div class={messageColumnClass}>
							<ContextCompactingRow
								state={contextCompaction.state}
								startedAt={contextCompaction.startedAt}
							/>
						</div>
					{/if}
				</section>
				<div class="pb-18" />
				{#if bottomPadding}
					<div class="  pb-6" />
				{/if}
			{/key}
		</div>
	{/if}
</div>
