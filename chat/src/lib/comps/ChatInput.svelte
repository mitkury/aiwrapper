<script lang="ts">

  const {
    onsubmit,
    waitForResponse,
    isRunning,
    onstop
  }: {
    onsubmit: (message: string) => void;
    waitForResponse: boolean;
    isRunning: boolean;
    onstop?: () => void;
  } = $props();

  let message = $state('');

  function handleSubmit(event: Event) {
    event.preventDefault();
    onsubmit(message);
    message = '';
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !waitForResponse && message.length > 0) {
      handleSubmit(event);
    }
  }
</script>

<div class="mx-auto w-full max-w-3xl">
  <form
    onsubmit={handleSubmit}
    class="flex items-center gap-2 rounded-full border border-neutral-200 px-4 py-2 shadow-lg"
  >
    <textarea
      class="flex-1 resize-none border-0 bg-transparent text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-0"
      placeholder="Type your message here..."
      bind:value={message}
      onkeydown={handleKeyDown}
      rows={1}
    ></textarea>
    {#if isRunning}
      <button
        type="button"
        aria-label="Stop"
        class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-white shadow-sm transition-colors hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
        onclick={() => onstop?.()}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5">
          <rect x="7" y="7" width="10" height="10" rx="2" />
        </svg>
      </button>
    {:else}
      <button
        type="submit"
        aria-label="Send message"
        class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm transition-colors hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={waitForResponse || message.length === 0}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
          <path d="m22 2-7 20-4-9-9-4Z"></path>
          <path d="M22 2 11 13"></path>
        </svg>
      </button>
    {/if}
  </form>
</div>
