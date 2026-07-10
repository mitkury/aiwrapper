# Handling interrupted tool calls

A request can stop after an assistant asks to use a tool but before the tool result is added. Most providers reject a later request if a tool call has no matching result.

Before sending a conversation, providers call `fixToolResultsIfNeeded`. It scans assistant tool requests and inserts a matching `tool-results` message when one is missing. The synthetic result is the string `"aborted"`.

This repair keeps the provider transcript valid. It does not execute the missing tool and does not pretend the original call succeeded. A warning is logged when a repair is made.

Applications that persist conversations may handle interruption explicitly instead:

1. Keep the partial assistant message.
2. Add a `tool-results` item for every incomplete request.
3. Use an application-specific cancelled or aborted result.
4. Add the next user message and continue with `chat`.

See [agent.md](agent.md) for cancellation and partial agent results.
