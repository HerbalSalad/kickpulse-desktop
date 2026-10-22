// src/hooks/useStickToBottom.ts — keeps a scrollable feed pinned to its
// newest content, but stops the instant the user scrolls away on purpose,
// and resumes the instant they scroll back down near the bottom.
//
// Direct report: "its not tracking it after a while. It should always be
// showing me the latest message somehow unless I scroll to earlier
// messages." DashboardPage.tsx's chat/event panels used to re-derive
// "am I near the bottom" from scrollHeight/scrollTop/clientHeight ONLY
// inside the effect that runs after new items are appended — a plain
// one-shot distance check, not a tracked intent. That ratchets shut
// permanently the moment several messages land in the same render (a
// burst — common the instant chat gets busy): scrollHeight grows by every
// new item's height all at once while scrollTop hasn't moved yet, which can
// push the distance-from-bottom past the threshold in a single tick. After
// that, since distance-from-bottom can only ever grow further as more
// messages keep arriving with scrollTop still pinned at its old value, that
// same check can never pass again on its own — auto-scroll silently stops
// "after a while" with no way back short of manually dragging the
// scrollbar all the way down yourself. This hook instead tracks the user's
// actual scroll position continuously via a real `scroll` listener
// (independent of how much content just got added), so a burst of messages
// can never desync it.
import { useEffect, useRef, useState } from 'react';

export function useStickToBottom<T extends HTMLElement>(deps: unknown[], threshold = 80) {
  const ref = useRef<T>(null);
  const stuck = useRef(true);
  const [isStuck, setIsStuck] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      stuck.current = atBottom;
      setIsStuck(atBottom);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [threshold]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !stuck.current) return;
    el.scrollTop = el.scrollHeight;
    // deps is the caller's own list/count — intentionally re-runs whenever
    // it changes, not just on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const jumpToBottom = () => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stuck.current = true;
    setIsStuck(true);
  };

  return { ref, isStuck, jumpToBottom };
}
