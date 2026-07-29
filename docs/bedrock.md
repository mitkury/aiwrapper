# AWS Bedrock

AIWrapper integrates with Amazon Bedrock through the AWS SDK's
`ConverseStream` API. Converse provides one message format across the Bedrock
models that support it, including supported open-weight models.

## Installation

The AWS SDK is an optional peer dependency so it is only installed by projects
that use Bedrock.

```bash
npm install aiwrapper @aws-sdk/client-bedrock-runtime
```

## Usage

```ts
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { BedrockLang } from "aiwrapper/bedrock";

const client = new BedrockRuntimeClient({
  region: "us-east-1",
});

const lang = new BedrockLang({
  client,
  model: "your-model-id-or-inference-profile-arn",
  maxTokens: 4096,
  temperature: 0.3,
});

const result = await lang.ask("Explain this architecture.");
console.log(result.answer);
```

Configure credentials through the normal AWS credential chain, such as an IAM
role, environment variables, a shared AWS config profile, or an explicit SDK
credential provider. AIWrapper does not read or store AWS credentials.

The `model` value is passed to Bedrock as `modelId`. It can be a supported
model ID, inference profile ID or ARN, provisioned model ARN, or supported
custom-model ARN.

## Features

The provider supports:

- streamed text and reasoning
- local function tools and streamed tool arguments
- base64 and data-URL image inputs
- multimodal local tool results
- native Bedrock JSON Schema output
- cancellation with `AbortSignal`
- Bedrock usage, latency, stop reason, and response fields in message metadata

Constructor inference options are `maxTokens`, `temperature`, `topP`, and
`stopSequences`. Use `providerSpecificBody` for other
`ConverseStreamCommandInput` fields:

```ts
await lang.ask("Answer quickly.", {
  providerSpecificBody: {
    performanceConfig: { latency: "optimized" },
    requestMetadata: { project: "my-service" },
  },
});
```

Per-call fields in `providerSpecificBody` are applied last, so they can override
constructor-generated request fields when necessary.

`providerSpecificHeaders` is not supported because requests are signed and sent
by the AWS SDK. Add custom headers through AWS SDK middleware instead.

## Model compatibility

Bedrock exposes several inference APIs, and support varies by model. This
provider deliberately targets `ConverseStream`; choose a model that supports
both Converse and streaming. Tool use, images, reasoning, and native structured
output also depend on the selected model.

Open-weight models work through this provider when Bedrock lists them as
Converse-compatible. The model still runs in Bedrock: access, region
availability, pricing, quotas, and inference-profile requirements are governed
by the AWS account and selected model.

Bedrock Converse accepts image bytes or supported S3 locations, not arbitrary
remote URLs. AIWrapper currently accepts base64 or data URLs and rejects remote
image URLs with a specific error. Assistant image output and signed reasoning
replay are not currently represented by AIWrapper's provider-neutral message
format.
