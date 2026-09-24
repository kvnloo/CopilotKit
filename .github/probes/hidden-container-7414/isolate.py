"""Fork-only source-pinned ablation; not a proposed production fix."""
import hashlib
from pathlib import Path

path = Path("packages/react-core/src/v2/components/chat/CopilotChatMessageView.tsx")
raw = path.read_bytes()
actual = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
assert actual == "044607fc843452b815f79cb444287f8b0a94809f", actual
before = '''  useLayoutEffect(() => {
    if (!shouldVirtualize || !deduplicatedMessages.length) return;
    virtualizer.scrollToIndex(deduplicatedMessages.length - 1, {
      align: "end",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldVirtualize, firstMessageId]);'''
after = '''  const probeAlignedThread = React.useRef<{ id: string | undefined } | null>(null);
  useLayoutEffect(() => {
    if (!shouldVirtualize || !deduplicatedMessages.length) return;
    if (probeAlignedThread.current?.id === firstMessageId) return;
    probeAlignedThread.current = { id: firstMessageId };
    virtualizer.scrollToIndex(deduplicatedMessages.length - 1, {
      align: "end",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldVirtualize, firstMessageId]);'''
text = raw.decode()
assert text.count(before) == 1, "Expected one exact activation effect"
path.write_text(text.replace(before, after, 1))
