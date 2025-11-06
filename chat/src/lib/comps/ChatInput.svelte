<script lang="ts">

  const { onsubmit, waitForResponse }: { onsubmit: (message: string) => void, waitForResponse: boolean } = $props();

  let message = $state('');

  function handleSubmit(event: Event) {
    event.preventDefault();
    onsubmit(message);
    message = '';
  }
</script>

<div class="mx-auto w-full max-w-3xl">
  <form onsubmit={handleSubmit} class="flex items-end gap-2">
    <textarea
      class="min-h-12 flex-1 resize-y rounded-lg border-neutral-300 bg-white px-3 py-2 shadow-sm focus:border-blue-400 focus:outline-none"
      placeholder="Type your message here..."
      bind:value={message}
    ></textarea>
    <button
      type="submit"
      aria-label="Send message"
      class="inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-white disabled:opacity-50"
      disabled={waitForResponse || message.length === 0}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
        <path d="m22 2-7 20-4-9-9-4Z"></path>
        <path d="M22 2 11 13"></path>
      </svg>
    </button>
  </form>
</div>