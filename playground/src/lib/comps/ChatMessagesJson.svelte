<script lang="ts">
  import type { LangMessage } from "aiwrapper";

  const { messages }: { messages: LangMessage[] } = $props();

  function cloneValue<T>(value: T): T {
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch (error) {
        console.warn("structuredClone failed, falling back to JSON clone", error);
      }
    }
    return JSON.parse(JSON.stringify(value)) as T;
  }

  const sanitizedMessages = $derived.by(() =>
    messages.map((message) => {
      const cloned = cloneValue(message);

      if (!cloned || typeof cloned !== "object") {
        return message;
      }

      if (Array.isArray((cloned as any).items)) {
        (cloned as any).items = (cloned as any).items.map((item: any) => {
          if (!item || item.type !== "image" || !item.base64) return item;

          const base64 =
            item.base64.length > 20
              ? item.base64.slice(0, 10) + "..." + item.base64.slice(item.base64.length - 10, item.base64.length)
              : item.base64;

          return { ...item, base64 };
        });
      }

      return cloned;
    })
  );

  const formattedMessages = $derived.by(() => JSON.stringify(sanitizedMessages, null, 2));
</script>

<pre class="overflow-x-auto whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-800">{formattedMessages}</pre>
