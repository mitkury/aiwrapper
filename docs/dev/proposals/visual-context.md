# Visual context: remaining experiments

Status: first version implemented; follow-up proposals. Updated November 17, 2026.

The researched initial proposal is preserved in Git history. Current policy,
research sources, Rust integration, simulator controls, diagnostics and validation
are documented in [Camera context and the 3D simulator](../../native-vision.md).

## Compare selection quality before adding complexity

Use repeatable walks through the simulator, keeping model, prompt, capture timing
and image resolution fixed. Compare latest-only against the recent-plus-spread
baseline on current-view questions, brief views, earlier exhibits and scene order.
Record the actual selected frames, answer correctness, time to first response,
provider usage and failures. The initial 12-frame budget is not an established
optimum. Evaluate alternative recent/older allocations before making it configurable.

If uniform sampling repeatedly misses important short views, choose representative
frames within time intervals using visual change or deduplication. Preserve the
latest frame and chronological timestamps. Measure whether additional compute
and changed coverage improve answers. Do not introduce another model, embedding
index or trained selector without evidence that the simple baseline is inadequate.

## Optional longer-term context

Selected observations linked to retained frames could support references to
objects outside the five-minute window. Keep application-owned frame IDs and
bounded persistence; retrieving a frame must provide its actual image to the
model. Treat textual observations as fallible summaries.

Provider-managed conversation state may avoid retransmitting unchanged context,
but does not remove context limits, billing or the need for a retention policy.
Any adapter must reconcile interruptions and playback corrections before reusing
provider state. Do not attach every historical image indefinitely.

## Inspector extensions

The current viewer shows exact selected request frames and aggregate omissions.
A future timeline could show all retained captures, mark each selected/skipped
frame, and export a bounded trace for repeatable comparisons. Persisting complete
sessions, scene ground truth and automated visual accuracy scoring are separate
features. Keep hidden simulator data out of model inputs when evaluating vision.
