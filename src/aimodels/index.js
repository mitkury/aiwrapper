// src/data.js
var models = {
  "claude-fable-5-1": {
    "id": "claude-fable-5-1",
    "name": "Claude Fable 5.1",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": 128e3
    },
    "releasedAt": "2026-09-01",
    "creatorId": "anthropic"
  },
  "claude-mythos-5-1": {
    "id": "claude-mythos-5-1",
    "extends": "claude-fable-5-1",
    "overrides": {
      "name": "Claude Mythos 5.1"
    },
    "releasedAt": "2026-09-01",
    "creatorId": "anthropic"
  },
  "claude-opus-5": {
    "id": "claude-opus-5",
    "name": "Claude Opus 5",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": 128e3,
      "outputIsFixed": 1
    },
    "releasedAt": "2026-07-24",
    "creatorId": "anthropic"
  },
  "claude-fable-5": {
    "id": "claude-fable-5",
    "name": "Claude Fable 5",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": 128e3,
      "outputIsFixed": 1
    },
    "releasedAt": "2026-06-09",
    "creatorId": "anthropic"
  },
  "claude-mythos-5": {
    "id": "claude-mythos-5",
    "extends": "claude-fable-5",
    "overrides": {
      "name": "Claude Mythos 5"
    },
    "releasedAt": "2026-06-09",
    "creatorId": "anthropic"
  },
  "claude-sonnet-5": {
    "id": "claude-sonnet-5",
    "extends": "claude-fable-5",
    "overrides": {
      "name": "Claude Sonnet 5"
    },
    "releasedAt": "2026-06-30",
    "creatorId": "anthropic"
  },
  "claude-opus-4-8": {
    "id": "claude-opus-4-8",
    "extends": "claude-fable-5",
    "overrides": {
      "name": "Claude Opus 4.8"
    },
    "releasedAt": "2026-05-28",
    "creatorId": "anthropic"
  },
  "claude-opus-4-7": {
    "id": "claude-opus-4-7",
    "extends": "claude-fable-5",
    "overrides": {
      "name": "Claude Opus 4.7"
    },
    "releasedAt": "2026-04-28",
    "creatorId": "anthropic"
  },
  "claude-sonnet-4-5-20250929": {
    "id": "claude-sonnet-4-5-20250929",
    "name": "Claude Sonnet 4.5",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 2e5,
      "maxOutput": 64e3,
      "outputIsFixed": 1
    },
    "aliases": [
      "claude-sonnet-4-5"
    ],
    "creatorId": "anthropic"
  },
  "claude-haiku-4-5-20251001": {
    "id": "claude-haiku-4-5-20251001",
    "name": "Claude Haiku 4.5",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 2e5,
      "maxOutput": 64e3,
      "outputIsFixed": 1
    },
    "aliases": [
      "claude-haiku-4-5"
    ],
    "creatorId": "anthropic"
  },
  "claude-opus-4-5-20251101": {
    "id": "claude-opus-4-5-20251101",
    "name": "Claude Opus 4.5",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 2e5,
      "maxOutput": 64e3,
      "outputIsFixed": 1
    },
    "aliases": [
      "claude-opus-4-5"
    ],
    "creatorId": "anthropic"
  },
  "claude-opus-4-6": {
    "id": "claude-opus-4-6",
    "extends": "claude-opus-4-5-20251101",
    "overrides": {
      "name": "Claude Opus 4.6",
      "context": {
        "type": "token",
        "total": 1e6,
        "maxOutput": 128e3,
        "outputIsFixed": 1
      }
    },
    "creatorId": "anthropic"
  },
  "claude-opus-4-1-20250805": {
    "id": "claude-opus-4-1-20250805",
    "name": "Claude Opus 4.1",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 2e5,
      "maxOutput": 32e3,
      "outputIsFixed": 1
    },
    "aliases": [
      "claude-opus-4-1"
    ],
    "creatorId": "anthropic"
  },
  "claude-opus-4-20250514": {
    "id": "claude-opus-4-20250514",
    "name": "Claude Opus 4",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 2e5,
      "maxOutput": 32e3,
      "outputIsFixed": 1
    },
    "aliases": [
      "claude-opus-4-0"
    ],
    "creatorId": "anthropic"
  },
  "claude-sonnet-4-20250514": {
    "id": "claude-sonnet-4-20250514",
    "name": "Claude Sonnet 4",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 2e5,
      "maxOutput": 64e3,
      "outputIsFixed": 1
    },
    "aliases": [
      "claude-sonnet-4-0"
    ],
    "creatorId": "anthropic"
  },
  "claude-sonnet-4-6": {
    "id": "claude-sonnet-4-6",
    "extends": "claude-sonnet-4-5-20250929",
    "overrides": {
      "name": "Claude Sonnet 4.6",
      "context": {
        "type": "token",
        "total": 1e6,
        "maxOutput": 64e3,
        "outputIsFixed": 1
      }
    },
    "creatorId": "anthropic"
  },
  "amazon.nova-2-lite-v1:0": {
    "id": "amazon.nova-2-lite-v1:0",
    "name": "Amazon Nova 2 Lite",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "video-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": 65536
    },
    "releasedAt": "2025-12-02",
    "creatorId": "aws"
  },
  "amazon.nova-2-sonic-v1:0": {
    "id": "amazon.nova-2-sonic-v1:0",
    "name": "Amazon Nova 2 Sonic",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "audio-in",
      "audio-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": 65536
    },
    "releasedAt": "2025-12-02",
    "creatorId": "aws"
  },
  "ernie-5.0": {
    "id": "ernie-5.0",
    "name": "ERNIE 5.0",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 65536
    },
    "releasedAt": "2026-01-22",
    "creatorId": "baidu"
  },
  "north-small-translate-1-0": {
    "id": "north-small-translate-1-0",
    "name": "North Small Translate 1.0",
    "license": "cc-by-nc-4.0",
    "capabilities": [
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 16384,
      "maxOutput": null
    },
    "releasedAt": "2026-09-09",
    "creatorId": "cohere"
  },
  "parse-v5.0": {
    "id": "parse-v5.0",
    "name": "Cohere Parse 5",
    "license": "proprietary",
    "capabilities": [
      "img-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 8192,
      "maxOutput": null
    },
    "releasedAt": "2026-08-27",
    "creatorId": "cohere"
  },
  "CohereLabs/North-Micro-Vision-Instruct": {
    "id": "CohereLabs/North-Micro-Vision-Instruct",
    "name": "North Micro Vision Instruct",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in"
    ],
    "context": {
      "type": "token",
      "total": 8192,
      "maxOutput": null
    },
    "creatorId": "cohere"
  },
  "command-a-plus-05-2026": {
    "id": "command-a-plus-05-2026",
    "name": "Command A+",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 128e3,
      "maxOutput": 64e3
    },
    "releasedAt": "2026-05-20",
    "creatorId": "cohere"
  },
  "north-mini-code-1-0": {
    "id": "north-mini-code-1-0",
    "name": "North Mini Code 1.0",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 256e3,
      "maxOutput": 64e3
    },
    "releasedAt": "2026-06-09",
    "creatorId": "cohere"
  },
  "command-a-reasoning-08-2025": {
    "id": "command-a-reasoning-08-2025",
    "name": "Command A Reasoning",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 256e3,
      "maxOutput": 32e3
    },
    "creatorId": "cohere"
  },
  "command-a-vision-07-2025": {
    "id": "command-a-vision-07-2025",
    "name": "Command A Vision",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 128e3,
      "maxOutput": 8e3
    },
    "creatorId": "cohere"
  },
  "embed-v4.0": {
    "id": "embed-v4.0",
    "name": "Embed v4.0",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "vec-out"
    ],
    "context": {
      "type": "embedding",
      "total": 128e3,
      "dimensions": 1536,
      "embeddingType": "multimodal",
      "normalized": true
    },
    "creatorId": "cohere"
  },
  "rerank-v4.0-pro": {
    "id": "rerank-v4.0-pro",
    "name": "Rerank v4.0 Pro",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 32e3,
      "maxOutput": null
    },
    "creatorId": "cohere"
  },
  "rerank-v4.0-fast": {
    "id": "rerank-v4.0-fast",
    "extends": "rerank-v4.0-pro",
    "overrides": {
      "name": "Rerank v4.0 Fast"
    },
    "creatorId": "cohere"
  },
  "cohere-transcribe-03-2026": {
    "id": "cohere-transcribe-03-2026",
    "name": "Cohere Transcribe",
    "license": "apache-2.0",
    "capabilities": [
      "audio-in",
      "txt-out"
    ],
    "context": {
      "type": "audio-in",
      "total": null,
      "maxOutput": null
    },
    "releasedAt": "2026-03-26",
    "creatorId": "cohere"
  },
  "cohere-transcribe-arabic-07-2026": {
    "id": "cohere-transcribe-arabic-07-2026",
    "extends": "cohere-transcribe-03-2026",
    "overrides": {
      "name": "Cohere Transcribe Arabic"
    },
    "releasedAt": "2026-07-07",
    "creatorId": "cohere"
  },
  "command-a-03-2025": {
    "id": "command-a-03-2025",
    "name": "Command A",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 256e3,
      "maxOutput": 8192
    },
    "creatorId": "cohere"
  },
  "command-r7b-12-2024": {
    "id": "command-r7b-12-2024",
    "name": "Command R7B",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 128e3,
      "maxOutput": 4096
    },
    "creatorId": "cohere"
  },
  "command-r-plus-04-2024": {
    "id": "command-r-plus-04-2024",
    "name": "Command R+ (April 2024)",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 128e3,
      "maxOutput": 4096
    },
    "aliases": [],
    "creatorId": "cohere"
  },
  "command-r-plus-08-2024": {
    "id": "command-r-plus-08-2024",
    "name": "Command R+",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 128e3,
      "maxOutput": 4096
    },
    "aliases": [
      "command-r-plus"
    ],
    "creatorId": "cohere"
  },
  "command-r-08-2024": {
    "id": "command-r-08-2024",
    "name": "Command R (August 2024)",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 128e3,
      "maxOutput": 4096
    },
    "creatorId": "cohere"
  },
  "command-r-03-2024": {
    "id": "command-r-03-2024",
    "name": "Command R",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 128e3,
      "maxOutput": 4096
    },
    "aliases": [
      "command-r"
    ],
    "creatorId": "cohere"
  },
  "command-nightly": {
    "id": "command-nightly",
    "name": "Command Nightly",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 128e3,
      "maxOutput": 4096
    },
    "creatorId": "cohere"
  },
  "command": {
    "id": "command",
    "name": "Command",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 4096,
      "maxOutput": 4096
    },
    "creatorId": "cohere"
  },
  "command-light": {
    "id": "command-light",
    "name": "Command Light",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 4096,
      "maxOutput": 4096
    },
    "creatorId": "cohere"
  },
  "embed-english-v3.0": {
    "id": "embed-english-v3.0",
    "name": "Embed English v3.0",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "vec-out"
    ],
    "context": {
      "type": "token",
      "total": 512,
      "maxOutput": 1024
    },
    "creatorId": "cohere"
  },
  "embed-english-light-v3.0": {
    "id": "embed-english-light-v3.0",
    "name": "Embed English Light v3.0",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "vec-out"
    ],
    "context": {
      "type": "token",
      "total": 512,
      "maxOutput": 384
    },
    "creatorId": "cohere"
  },
  "embed-multilingual-v3.0": {
    "id": "embed-multilingual-v3.0",
    "name": "Embed Multilingual v3.0",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "vec-out"
    ],
    "context": {
      "type": "token",
      "total": 512,
      "maxOutput": 1024
    },
    "creatorId": "cohere"
  },
  "embed-multilingual-light-v3.0": {
    "id": "embed-multilingual-light-v3.0",
    "name": "Embed Multilingual Light v3.0",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "vec-out"
    ],
    "context": {
      "type": "token",
      "total": 512,
      "maxOutput": 384
    },
    "creatorId": "cohere"
  },
  "rerank-v3.5": {
    "id": "rerank-v3.5",
    "name": "Rerank v3.5",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 4096,
      "maxOutput": null
    },
    "creatorId": "cohere"
  },
  "rerank-english-v3.0": {
    "id": "rerank-english-v3.0",
    "name": "Rerank English v3.0",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 4096,
      "maxOutput": null
    },
    "creatorId": "cohere"
  },
  "rerank-multilingual-v3.0": {
    "id": "rerank-multilingual-v3.0",
    "name": "Rerank Multilingual v3.0",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 4096,
      "maxOutput": null
    },
    "creatorId": "cohere"
  },
  "embed-english-v2.0": {
    "id": "embed-english-v2.0",
    "name": "Embed English v2.0",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "vec-out"
    ],
    "context": {
      "type": "embedding",
      "total": 512,
      "dimensions": 4096,
      "embeddingType": "text",
      "normalized": true
    },
    "creatorId": "cohere"
  },
  "embed-english-light-v2.0": {
    "id": "embed-english-light-v2.0",
    "name": "Embed English Light v2.0",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "vec-out"
    ],
    "context": {
      "type": "embedding",
      "total": 512,
      "dimensions": 1024,
      "embeddingType": "text",
      "normalized": true
    },
    "creatorId": "cohere"
  },
  "embed-multilingual-v2.0": {
    "id": "embed-multilingual-v2.0",
    "name": "Embed Multilingual v2.0",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "vec-out"
    ],
    "context": {
      "type": "embedding",
      "total": 256,
      "dimensions": 768,
      "embeddingType": "text",
      "normalized": false
    },
    "creatorId": "cohere"
  },
  "c4ai-aya-expanse-8b": {
    "id": "c4ai-aya-expanse-8b",
    "name": "Aya Expanse 8B",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 8192,
      "maxOutput": 4096
    },
    "creatorId": "cohere"
  },
  "c4ai-aya-expanse-32b": {
    "id": "c4ai-aya-expanse-32b",
    "name": "Aya Expanse 32B",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 128e3,
      "maxOutput": 4096
    },
    "creatorId": "cohere"
  },
  "c4ai-aya-vision-8b": {
    "id": "c4ai-aya-vision-8b",
    "name": "Aya Vision 8B",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in"
    ],
    "context": {
      "type": "token",
      "total": 16384,
      "maxOutput": 4096
    },
    "creatorId": "cohere"
  },
  "c4ai-aya-vision-32b": {
    "id": "c4ai-aya-vision-32b",
    "name": "Aya Vision 32B",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in"
    ],
    "context": {
      "type": "token",
      "total": 16384,
      "maxOutput": 4096
    },
    "creatorId": "cohere"
  },
  "deepseek-flash": {
    "id": "deepseek-flash",
    "name": "DeepSeek V4.1 Flash",
    "license": "mit",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 393216
    },
    "releasedAt": "2026-09-10",
    "creatorId": "deepseek"
  },
  "deepseek-v4-flash-vision-exp": {
    "id": "deepseek-v4-flash-vision-exp",
    "name": "DeepSeek V4 Flash Vision Experimental",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": 384e3
    },
    "releasedAt": "2026-08-21",
    "creatorId": "deepseek"
  },
  "deepseek-v4-pro": {
    "id": "deepseek-v4-pro",
    "name": "DeepSeek V4 Pro",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": 384e3
    },
    "releasedAt": "2026-04-24",
    "creatorId": "deepseek"
  },
  "deepseek-v4-flash": {
    "id": "deepseek-v4-flash",
    "extends": "deepseek-v4-pro",
    "overrides": {
      "name": "DeepSeek V4 Flash"
    },
    "releasedAt": "2026-04-24",
    "creatorId": "deepseek"
  },
  "deepseek-chat": {
    "id": "deepseek-chat",
    "name": "DeepSeek V3.2",
    "license": "mit",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 8192
    },
    "aliases": [
      "deepseek-v3.2",
      "deepseek-v3.2-latest"
    ],
    "creatorId": "deepseek"
  },
  "deepseek-reasoner": {
    "id": "deepseek-reasoner",
    "name": "DeepSeek V3.2 (Thinking Mode)",
    "license": "mit",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 65536
    },
    "aliases": [
      "deepseek-v3.2-thinking",
      "deepseek-reasoner-latest"
    ],
    "creatorId": "deepseek"
  },
  "gemini-3.8-live": {
    "id": "gemini-3.8-live",
    "name": "Gemini 3.8 Live",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "audio-out",
      "video-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 65536
    },
    "releasedAt": "2026-09-15",
    "creatorId": "google"
  },
  "gemini-3.8-live-extended-thinking": {
    "id": "gemini-3.8-live-extended-thinking",
    "extends": "gemini-3.8-live",
    "overrides": {
      "name": "Gemini 3.8 Live Extended Thinking"
    },
    "releasedAt": "2026-09-15",
    "creatorId": "google"
  },
  "gemini-3.8-flash": {
    "id": "gemini-3.8-flash",
    "name": "Gemini 3.8 Flash",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason",
      "audio-in",
      "video-in"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 65536
    },
    "releasedAt": "2026-09-02",
    "creatorId": "google"
  },
  "gemini-3.5-transcribe": {
    "id": "gemini-3.5-transcribe",
    "name": "Gemini 3.5 Transcribe",
    "license": "proprietary",
    "capabilities": [
      "audio-in",
      "txt-out"
    ],
    "context": {
      "type": "audio-in",
      "total": 3600,
      "maxOutput": null
    },
    "releasedAt": "2026-08-26",
    "creatorId": "google"
  },
  "gemini-3.5-transcribe-live": {
    "id": "gemini-3.5-transcribe-live",
    "extends": "gemini-3.5-transcribe",
    "overrides": {
      "name": "Gemini 3.5 Transcribe Live",
      "context": {
        "type": "audio-in",
        "total": null,
        "maxOutput": null
      }
    },
    "releasedAt": "2026-08-26",
    "creatorId": "google"
  },
  "gemini-omni-1.1-flash": {
    "id": "gemini-omni-1.1-flash",
    "name": "Gemini Omni 1.1 Flash",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "video-in",
      "video-out"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": null
    },
    "releasedAt": "2026-08-27",
    "creatorId": "google"
  },
  "lyria-3.5": {
    "id": "lyria-3.5",
    "name": "Lyria 3.5",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "txt-out",
      "audio-out"
    ],
    "context": {
      "type": "audio-out",
      "total": null,
      "maxOutput": null
    },
    "releasedAt": "2026-09-03",
    "creatorId": "google"
  },
  "gemini-3.7-flash": {
    "id": "gemini-3.7-flash",
    "name": "Gemini 3.7 Flash",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 65536
    },
    "releasedAt": "2026-08-13",
    "creatorId": "google"
  },
  "gemini-robotics-er-2-preview": {
    "id": "gemini-robotics-er-2-preview",
    "name": "Gemini Robotics ER 2 Preview",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 65536
    },
    "releasedAt": "2026-07-30",
    "creatorId": "google"
  },
  "gemini-robotics-er-2-streaming-preview": {
    "id": "gemini-robotics-er-2-streaming-preview",
    "extends": "gemini-robotics-er-2-preview",
    "overrides": {
      "name": "Gemini Robotics ER 2 Streaming Preview",
      "capabilities": [
        "chat",
        "txt-in",
        "txt-out",
        "img-in",
        "audio-in",
        "video-in",
        "fn-out",
        "reason"
      ]
    },
    "releasedAt": "2026-07-30",
    "creatorId": "google"
  },
  "gemini-3.6-flash": {
    "id": "gemini-3.6-flash",
    "name": "Gemini 3.6 Flash",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 65536
    },
    "releasedAt": "2026-07-21",
    "creatorId": "google"
  },
  "gemini-3.5-flash-lite": {
    "id": "gemini-3.5-flash-lite",
    "extends": "gemini-3.6-flash",
    "overrides": {
      "name": "Gemini 3.5 Flash-Lite"
    },
    "releasedAt": "2026-07-21",
    "creatorId": "google"
  },
  "gemini-3.5-flash": {
    "id": "gemini-3.5-flash",
    "name": "Gemini 3.5 Flash",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 65536
    },
    "aliases": [
      "gemini-flash-latest"
    ],
    "releasedAt": "2026-05-19",
    "creatorId": "google"
  },
  "gemini-3.1-flash-lite": {
    "id": "gemini-3.1-flash-lite",
    "extends": "gemini-3.5-flash",
    "overrides": {
      "name": "Gemini 3.1 Flash-Lite"
    },
    "releasedAt": "2026-05-07",
    "creatorId": "google"
  },
  "gemini-3.1-flash-live-preview": {
    "id": "gemini-3.1-flash-live-preview",
    "name": "Gemini 3.1 Flash Live Preview",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "audio-out",
      "video-in",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": null,
      "maxOutput": null
    },
    "releasedAt": "2026-03-26",
    "creatorId": "google"
  },
  "gemini-3.1-flash-tts-preview": {
    "id": "gemini-3.1-flash-tts-preview",
    "name": "Gemini 3.1 Flash TTS Preview",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "audio-out"
    ],
    "context": {
      "type": "token",
      "total": 8192,
      "maxOutput": 16384
    },
    "creatorId": "google"
  },
  "gemini-3-pro-preview": {
    "id": "gemini-3-pro-preview",
    "name": "Gemini 3 Pro Preview",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "img-in",
      "audio-in",
      "video-in",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 65536
    },
    "creatorId": "google"
  },
  "gemini-3-flash-preview": {
    "id": "gemini-3-flash-preview",
    "name": "Gemini 3 Flash Preview",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "img-in",
      "audio-in",
      "video-in",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 65536
    },
    "creatorId": "google"
  },
  "gemini-3.1-pro-preview": {
    "id": "gemini-3.1-pro-preview",
    "extends": "gemini-3-pro-preview",
    "overrides": {
      "name": "Gemini 3.1 Pro Preview"
    },
    "creatorId": "google"
  },
  "gemini-3-pro-image-preview": {
    "id": "gemini-3-pro-image-preview",
    "name": "Gemini 3 Pro Image Preview",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "img-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 65536,
      "maxOutput": 32768
    },
    "creatorId": "google"
  },
  "gemini-3.1-flash-image-preview": {
    "id": "gemini-3.1-flash-image-preview",
    "name": "Gemini 3.1 Flash Image Preview",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "img-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 32768
    },
    "creatorId": "google"
  },
  "gemini-3.1-flash-image": {
    "id": "gemini-3.1-flash-image",
    "extends": "gemini-3.1-flash-image-preview",
    "overrides": {
      "name": "Gemini 3.1 Flash Image"
    },
    "releasedAt": "2026-05-28",
    "creatorId": "google"
  },
  "gemini-3.1-flash-lite-image": {
    "id": "gemini-3.1-flash-lite-image",
    "name": "Gemini 3.1 Flash Lite Image",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "img-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 65536,
      "maxOutput": 4096
    },
    "releasedAt": "2026-06-30",
    "creatorId": "google"
  },
  "gemini-3-pro-image": {
    "id": "gemini-3-pro-image",
    "extends": "gemini-3-pro-image-preview",
    "overrides": {
      "name": "Gemini 3 Pro Image"
    },
    "releasedAt": "2026-05-28",
    "creatorId": "google"
  },
  "gemini-omni-flash-preview": {
    "id": "gemini-omni-flash-preview",
    "name": "Gemini Omni Flash Preview",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "audio-in",
      "video-in",
      "video-out"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": null
    },
    "releasedAt": "2026-06-30",
    "creatorId": "google"
  },
  "lyria-3-clip-preview": {
    "id": "lyria-3-clip-preview",
    "name": "Lyria 3 Clip Preview",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "audio-out"
    ],
    "context": {
      "type": "audio-out",
      "total": null,
      "maxOutput": 30
    },
    "releasedAt": "2026-03-25",
    "creatorId": "google"
  },
  "lyria-3-pro-preview": {
    "id": "lyria-3-pro-preview",
    "extends": "lyria-3-clip-preview",
    "overrides": {
      "name": "Lyria 3 Pro Preview",
      "context": {
        "type": "audio-out",
        "total": null,
        "maxOutput": null
      }
    },
    "releasedAt": "2026-03-25",
    "creatorId": "google"
  },
  "gemini-2.5-pro": {
    "id": "gemini-2.5-pro",
    "name": "Gemini 2.5 Pro",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 65536
    },
    "aliases": [
      "gemini-2.5"
    ],
    "creatorId": "google"
  },
  "gemini-2.5-pro-preview-06-05": {
    "id": "gemini-2.5-pro-preview-06-05",
    "extends": "gemini-2.5-pro",
    "overrides": {
      "name": "Gemini 2.5 Pro Preview 06-05"
    },
    "creatorId": "google"
  },
  "gemini-2.5-flash": {
    "id": "gemini-2.5-flash",
    "name": "Gemini 2.5 Flash",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 65536
    },
    "aliases": [
      "gemini-2.5-flash-latest"
    ],
    "creatorId": "google"
  },
  "gemini-2.5-flash-preview-09-2025": {
    "id": "gemini-2.5-flash-preview-09-2025",
    "extends": "gemini-2.5-flash",
    "overrides": {
      "name": "Gemini 2.5 Flash Preview 09-25"
    },
    "creatorId": "google"
  },
  "gemini-2.5-flash-lite": {
    "id": "gemini-2.5-flash-lite",
    "name": "Gemini 2.5 Flash Lite",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 65536
    },
    "aliases": [
      "gemini-flash-lite-latest"
    ],
    "creatorId": "google"
  },
  "gemini-2.5-flash-lite-preview-09-2025": {
    "id": "gemini-2.5-flash-lite-preview-09-2025",
    "extends": "gemini-2.5-flash-lite",
    "overrides": {
      "name": "Gemini 2.5 Flash Lite Preview 09-25"
    },
    "creatorId": "google"
  },
  "gemini-3.1-flash-lite-preview": {
    "id": "gemini-3.1-flash-lite-preview",
    "extends": "gemini-2.5-flash-lite",
    "overrides": {
      "name": "Gemini 3.1 Flash-Lite Preview",
      "context": {
        "type": "token",
        "total": 1048576,
        "maxOutput": 65535
      }
    },
    "creatorId": "google"
  },
  "gemini-live-2.5-flash-native-audio": {
    "id": "gemini-live-2.5-flash-native-audio",
    "name": "Gemini Live 2.5 Flash Native Audio",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "audio-out",
      "video-in",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 128e3,
      "maxOutput": 64e3
    },
    "creatorId": "google"
  },
  "gemini-2.0-flash": {
    "id": "gemini-2.0-flash",
    "name": "Gemini 2.0 Flash",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "video-in",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 8192
    },
    "creatorId": "google"
  },
  "gemini-2.0-flash-lite": {
    "id": "gemini-2.0-flash-lite",
    "name": "Gemini 2.0 Flash Lite",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "video-in",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 8192
    },
    "creatorId": "google"
  },
  "gemma-3-1b": {
    "id": "gemma-3-1b",
    "name": "Gemma 3 1B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 40960,
      "maxOutput": 8192
    },
    "creatorId": "google"
  },
  "gemma-3-4b": {
    "id": "gemma-3-4b",
    "name": "Gemma 3 4B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "img-in"
    ],
    "context": {
      "type": "token",
      "total": 40960,
      "maxOutput": 8192
    },
    "creatorId": "google"
  },
  "gemma-3-12b": {
    "id": "gemma-3-12b",
    "name": "Gemma 3 12B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "img-in"
    ],
    "context": {
      "type": "token",
      "total": 40960,
      "maxOutput": 8192
    },
    "creatorId": "google"
  },
  "gemma-3-27b": {
    "id": "gemma-3-27b",
    "name": "Gemma 3 27B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "img-in"
    ],
    "context": {
      "type": "token",
      "total": 40960,
      "maxOutput": 8192
    },
    "creatorId": "google"
  },
  "gemma-3-1b-it": {
    "id": "gemma-3-1b-it",
    "name": "Gemma 3 1B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 32768,
      "maxOutput": 8192
    },
    "creatorId": "google"
  },
  "gemma-3-4b-it": {
    "id": "gemma-3-4b-it",
    "extends": "gemma-3-1b-it",
    "overrides": {
      "name": "Gemma 3 4B"
    },
    "creatorId": "google"
  },
  "gemma-3-12b-it": {
    "id": "gemma-3-12b-it",
    "extends": "gemma-3-1b-it",
    "overrides": {
      "name": "Gemma 3 12B"
    },
    "creatorId": "google"
  },
  "gemma-3-27b-it": {
    "id": "gemma-3-27b-it",
    "extends": "gemma-3-1b-it",
    "overrides": {
      "name": "Gemma 3 27B",
      "context": {
        "type": "token",
        "total": 131072,
        "maxOutput": 8192
      }
    },
    "creatorId": "google"
  },
  "gemma-3n-e4b-it": {
    "id": "gemma-3n-e4b-it",
    "name": "Gemma 3n E4B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 8192,
      "maxOutput": 2048
    },
    "creatorId": "google"
  },
  "text-embedding-004": {
    "id": "text-embedding-004",
    "name": "Text Embedding 004",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "vec-out"
    ],
    "context": {
      "type": "token",
      "total": 2048,
      "maxOutput": 768
    },
    "creatorId": "google"
  },
  "gemini-embedding-001": {
    "id": "gemini-embedding-001",
    "name": "Gemini Embedding 001",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "vec-out"
    ],
    "context": {
      "type": "embedding",
      "total": 2048,
      "unit": "tokens",
      "dimensions": 3072,
      "embeddingType": "text"
    },
    "creatorId": "google"
  },
  "gemini-embedding-2-preview": {
    "id": "gemini-embedding-2-preview",
    "name": "Gemini Embedding 2 Preview",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "audio-in",
      "video-in",
      "vec-out"
    ],
    "context": {
      "type": "embedding",
      "total": 8192,
      "unit": "tokens",
      "dimensions": 3072,
      "embeddingType": "multimodal"
    },
    "creatorId": "google"
  },
  "text-embedding-005": {
    "id": "text-embedding-005",
    "name": "Text Embedding 005",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "vec-out"
    ],
    "context": {
      "type": "embedding",
      "total": 2048,
      "unit": "tokens",
      "dimensions": 768,
      "embeddingType": "text"
    },
    "creatorId": "google"
  },
  "text-multilingual-embedding-002": {
    "id": "text-multilingual-embedding-002",
    "name": "Text Multilingual Embedding 002",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "vec-out"
    ],
    "context": {
      "type": "embedding",
      "total": 2048,
      "unit": "tokens",
      "dimensions": 768,
      "embeddingType": "text"
    },
    "creatorId": "google"
  },
  "multimodalembedding@001": {
    "id": "multimodalembedding@001",
    "name": "Multimodal Embedding 001",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "video-in",
      "vec-out"
    ],
    "context": {
      "type": "embedding",
      "dimensions": 1408,
      "embeddingType": "multimodal"
    },
    "creatorId": "google"
  },
  "aqa": {
    "id": "aqa",
    "name": "Attributed Question Answering",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 7168,
      "maxOutput": 1024
    },
    "creatorId": "google"
  },
  "gemini-2.5-flash-image": {
    "id": "gemini-2.5-flash-image",
    "name": "Gemini 2.5 Flash Image (Nano Banana)",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "img-out"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 65535
    },
    "aliases": [
      "nano-banana"
    ],
    "creatorId": "google"
  },
  "imagen-3.0-generate-002": {
    "id": "imagen-3.0-generate-002",
    "name": "Imagen 3.0",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-out"
    ],
    "context": {
      "maxOutput": 1,
      "sizes": [
        "1024x1024",
        "1792x1024",
        "1024x1792"
      ]
    },
    "creatorId": "google"
  },
  "imagen-4.0-generate-001": {
    "id": "imagen-4.0-generate-001",
    "name": "Imagen 4.0",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-out"
    ],
    "context": {
      "maxOutput": 4,
      "sizes": [
        "1024x1024",
        "896x1280",
        "1280x896",
        "768x1408",
        "1408x768",
        "2048x2048",
        "1792x2560",
        "2560x1792",
        "1536x2816",
        "2816x1536"
      ]
    },
    "creatorId": "google"
  },
  "imagen-4.0-fast-generate-001": {
    "id": "imagen-4.0-fast-generate-001",
    "name": "Imagen 4.0 Fast",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-out"
    ],
    "context": {
      "maxOutput": 4,
      "sizes": [
        "1024x1024",
        "896x1280",
        "1280x896",
        "768x1408",
        "1408x768"
      ]
    },
    "creatorId": "google"
  },
  "imagen-4.0-ultra-generate-001": {
    "id": "imagen-4.0-ultra-generate-001",
    "name": "Imagen 4.0 Ultra",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-out"
    ],
    "context": {
      "maxOutput": 4,
      "sizes": [
        "1024x1024",
        "896x1280",
        "1280x896",
        "768x1408",
        "1408x768",
        "2048x2048",
        "1792x2560",
        "2560x1792",
        "1536x2816",
        "2816x1536"
      ]
    },
    "creatorId": "google"
  },
  "veo-2.0-generate-001": {
    "id": "veo-2.0-generate-001",
    "name": "Veo 2",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "video-out"
    ],
    "context": {
      "type": "token",
      "total": 480,
      "maxOutput": 8192
    },
    "creatorId": "google"
  },
  "veo-3.0-generate-preview": {
    "id": "veo-3.0-generate-preview",
    "name": "Veo 3.0 Generate",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "video-out"
    ],
    "context": {
      "type": "token",
      "total": 480,
      "maxOutput": 8192
    },
    "creatorId": "google"
  },
  "veo-3.0-generate-001": {
    "id": "veo-3.0-generate-001",
    "name": "Veo 3.0 Generate",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "video-out"
    ],
    "context": {
      "type": "token",
      "total": 480,
      "maxOutput": 8192
    },
    "creatorId": "google"
  },
  "veo-3.0-fast-generate-001": {
    "id": "veo-3.0-fast-generate-001",
    "extends": "veo-3.0-generate-preview",
    "overrides": {
      "name": "Veo 3.0 Fast Generate"
    },
    "creatorId": "google"
  },
  "veo-3.1-generate-preview": {
    "id": "veo-3.1-generate-preview",
    "name": "Veo 3.1 Generate",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "video-out"
    ],
    "context": {
      "type": "token",
      "total": 480,
      "maxOutput": 8192
    },
    "creatorId": "google"
  },
  "veo-3.1-generate-001": {
    "id": "veo-3.1-generate-001",
    "extends": "veo-3.1-generate-preview",
    "overrides": {
      "name": "Veo 3.1 Generate"
    },
    "creatorId": "google"
  },
  "veo-3.1-fast-generate-preview": {
    "id": "veo-3.1-fast-generate-preview",
    "name": "Veo 3.1 Fast Generate",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "video-out"
    ],
    "context": {
      "type": "token",
      "total": 480,
      "maxOutput": 8192
    },
    "creatorId": "google"
  },
  "veo-3.1-fast-generate-001": {
    "id": "veo-3.1-fast-generate-001",
    "extends": "veo-3.1-fast-generate-preview",
    "overrides": {
      "name": "Veo 3.1 Fast Generate"
    },
    "creatorId": "google"
  },
  "veo-3.1-lite-generate-preview": {
    "id": "veo-3.1-lite-generate-preview",
    "name": "Veo 3.1 Lite Preview",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "video-out"
    ],
    "context": {
      "type": "token",
      "total": 480,
      "maxOutput": 8192
    },
    "releasedAt": "2026-03-31",
    "creatorId": "google"
  },
  "kimi-k3": {
    "id": "kimi-k3",
    "name": "Kimi K3",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 1048576
    },
    "releasedAt": "2026-07-16",
    "creatorId": "kimi"
  },
  "kimi-k2.7-code": {
    "id": "kimi-k2.7-code",
    "name": "Kimi K2.7 Code",
    "license": "modified-mit",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 262144,
      "maxOutput": null
    },
    "aliases": [
      "kimi-k2.7-code-highspeed"
    ],
    "releasedAt": "2026-06-12",
    "creatorId": "kimi"
  },
  "kimi-k2.6": {
    "id": "kimi-k2.6",
    "name": "Kimi K2.6",
    "license": "modified-mit",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 262144,
      "maxOutput": 32768
    },
    "releasedAt": "2026-06-13",
    "creatorId": "kimi"
  },
  "kimi-k2.5": {
    "id": "kimi-k2.5",
    "name": "Kimi K2.5",
    "license": "modified-mit",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 262144,
      "maxOutput": 32768
    },
    "aliases": [
      "kimi-k2.5-latest"
    ],
    "creatorId": "kimi"
  },
  "kimi-k2-0905-preview": {
    "id": "kimi-k2-0905-preview",
    "name": "Kimi K2 0905 Preview",
    "license": "modified-mit",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 262144,
      "maxOutput": 32768
    },
    "aliases": [
      "kimi-k2"
    ],
    "creatorId": "kimi"
  },
  "kimi-k2-turbo-preview": {
    "id": "kimi-k2-turbo-preview",
    "extends": "kimi-k2-0905-preview",
    "overrides": {
      "name": "Kimi K2 Turbo Preview"
    },
    "creatorId": "kimi"
  },
  "kimi-k2-thinking": {
    "id": "kimi-k2-thinking",
    "extends": "kimi-k2-0905-preview",
    "overrides": {
      "name": "Kimi K2 Thinking",
      "capabilities": [
        "chat",
        "txt-in",
        "txt-out",
        "json-out",
        "fn-out",
        "reason"
      ]
    },
    "creatorId": "kimi"
  },
  "kimi-k2-thinking-turbo": {
    "id": "kimi-k2-thinking-turbo",
    "extends": "kimi-k2-thinking",
    "overrides": {
      "name": "Kimi K2 Thinking Turbo"
    },
    "creatorId": "kimi"
  },
  "kimi-k2-0711-preview": {
    "id": "kimi-k2-0711-preview",
    "extends": "kimi-k2-0905-preview",
    "overrides": {
      "name": "Kimi K2 0711 Preview",
      "context": {
        "type": "token",
        "total": 131072,
        "maxOutput": 32768
      }
    },
    "creatorId": "kimi"
  },
  "muse-spark-1.3": {
    "id": "muse-spark-1.3",
    "name": "Muse Spark 1.3",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason",
      "video-in"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": null
    },
    "aliases": [
      "muse-spark-1.3-contributor"
    ],
    "releasedAt": "2026-09-02",
    "creatorId": "meta"
  },
  "muse-image-1.0": {
    "id": "muse-image-1.0",
    "name": "Muse Image 1.0",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "img-out",
      "reason"
    ],
    "context": {
      "maxOutput": 10,
      "sizes": []
    },
    "creatorId": "meta"
  },
  "muse-voice-transcribe-1.0": {
    "id": "muse-voice-transcribe-1.0",
    "name": "Muse Voice Transcribe 1.0",
    "license": "proprietary",
    "capabilities": [
      "audio-in",
      "txt-out"
    ],
    "context": {
      "type": "audio-in",
      "total": null,
      "maxOutput": null
    },
    "creatorId": "meta"
  },
  "muse-spark-1.1": {
    "id": "muse-spark-1.1",
    "name": "Muse Spark 1.1",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": null
    },
    "releasedAt": "2026-07-09",
    "creatorId": "meta"
  },
  "muse-spark-1.2": {
    "id": "muse-spark-1.2",
    "extends": "muse-spark-1.1",
    "overrides": {
      "name": "Muse Spark 1.2",
      "aliases": [
        "muse-spark-1.2-contributor"
      ]
    },
    "creatorId": "meta"
  },
  "meta-models/Muse-Glimmer-30B": {
    "id": "meta-models/Muse-Glimmer-30B",
    "name": "Muse Glimmer 30B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": null
    },
    "releasedAt": "2026-08-09",
    "creatorId": "meta"
  },
  "llama-4-scout": {
    "id": "llama-4-scout",
    "name": "Llama 4 Scout",
    "license": "llama-4-community",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "img-in",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e7,
      "maxOutput": 65536
    },
    "aliases": [
      "llama-4-scout-2025-04",
      "llama-4-scout-latest"
    ],
    "creatorId": "meta"
  },
  "llama-4-maverick": {
    "id": "llama-4-maverick",
    "name": "Llama 4 Maverick",
    "license": "llama-4-community",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "img-in",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": 65536
    },
    "aliases": [
      "llama-4-maverick-2025-04",
      "llama-4-maverick-latest"
    ],
    "creatorId": "meta"
  },
  "llama3-70b-8192": {
    "id": "llama3-70b-8192",
    "name": "Llama 3 70B",
    "license": "llama-3-community",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 8192,
      "maxOutput": 4096
    },
    "creatorId": "meta"
  },
  "llama3-8b-8192": {
    "id": "llama3-8b-8192",
    "name": "Llama 3 8B",
    "license": "llama-3-community",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 8192,
      "maxOutput": 4096
    },
    "creatorId": "meta"
  },
  "llama-3.2-11b-vision-preview": {
    "id": "llama-3.2-11b-vision-preview",
    "name": "Llama 3.2 11B Vision",
    "license": "llama-3-community",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in"
    ],
    "context": {
      "type": "token",
      "total": 4096,
      "maxOutput": 4096
    },
    "creatorId": "meta"
  },
  "llama-3.2-90b-vision-preview": {
    "id": "llama-3.2-90b-vision-preview",
    "name": "Llama 3.2 90B Vision",
    "license": "llama-3-community",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in"
    ],
    "context": {
      "type": "token",
      "total": 4096,
      "maxOutput": 4096
    },
    "creatorId": "meta"
  },
  "llama-guard-3-8b": {
    "id": "llama-guard-3-8b",
    "name": "LlamaGuard 3 8B",
    "license": "llama-3-community",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 4096,
      "maxOutput": 4096
    },
    "creatorId": "meta"
  },
  "llama-3.1-8b-instant": {
    "id": "llama-3.1-8b-instant",
    "name": "Llama 3.1 8B",
    "license": "llama-3-community",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 131072
    },
    "aliases": [
      "llama-3.1-8b"
    ],
    "creatorId": "meta"
  },
  "llama-3.3-70b-versatile": {
    "id": "llama-3.3-70b-versatile",
    "name": "Llama 3.3 70B",
    "license": "llama-3-community",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 32768
    },
    "aliases": [
      "llama-3.3-70b"
    ],
    "creatorId": "meta"
  },
  "meta-llama/llama-guard-4-12b": {
    "id": "meta-llama/llama-guard-4-12b",
    "name": "LlamaGuard 4 12B",
    "license": "llama-4-community",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 1024
    },
    "aliases": [
      "llama-guard-4-12b"
    ],
    "creatorId": "meta"
  },
  "meta-llama/llama-4-maverick-17b-128e-instruct": {
    "id": "meta-llama/llama-4-maverick-17b-128e-instruct",
    "name": "Llama 4 Maverick 17B 128E",
    "license": "llama-4-community",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "img-in",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 8192
    },
    "aliases": [
      "llama-4-maverick-17b-128e"
    ],
    "creatorId": "meta"
  },
  "meta-llama/llama-4-scout-17b-16e-instruct": {
    "id": "meta-llama/llama-4-scout-17b-16e-instruct",
    "name": "Llama 4 Scout 17B 16E",
    "license": "llama-4-community",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "img-in",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 8192
    },
    "aliases": [
      "llama-4-scout-17b-16e"
    ],
    "creatorId": "meta"
  },
  "meta-llama/llama-prompt-guard-2-22m": {
    "id": "meta-llama/llama-prompt-guard-2-22m",
    "name": "Llama Prompt Guard 2 22M",
    "license": "llama-3-community",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 512,
      "maxOutput": 512
    },
    "aliases": [
      "llama-prompt-guard-2-22m"
    ],
    "creatorId": "meta"
  },
  "meta-llama/llama-prompt-guard-2-86m": {
    "id": "meta-llama/llama-prompt-guard-2-86m",
    "name": "Llama Prompt Guard 2 86M",
    "license": "llama-3-community",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 512,
      "maxOutput": 512
    },
    "aliases": [
      "llama-prompt-guard-2-86m"
    ],
    "creatorId": "meta"
  },
  "MiniMax-H3-Max": {
    "id": "MiniMax-H3-Max",
    "name": "MiniMax H3 Max",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "video-out"
    ],
    "context": {
      "maxOutput": 1,
      "sizes": [
        "480p",
        "768p"
      ]
    },
    "creatorId": "minimax"
  },
  "MiniMax-H3": {
    "id": "MiniMax-H3",
    "name": "MiniMax H3",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "audio-in",
      "video-in",
      "video-out"
    ],
    "context": {
      "maxOutput": 1,
      "sizes": [
        "768p",
        "2k"
      ]
    },
    "releasedAt": "2026-07-31",
    "creatorId": "minimax"
  },
  "MiniMax-M3": {
    "id": "MiniMax-M3",
    "name": "MiniMax M3",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "video-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": null
    },
    "releasedAt": "2026-06-01",
    "creatorId": "minimax"
  },
  "MiniMax-M2.7": {
    "id": "MiniMax-M2.7",
    "name": "MiniMax M2.7",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 204800,
      "maxOutput": null
    },
    "releasedAt": "2026-03-18",
    "creatorId": "minimax"
  },
  "MiniMax-M2.7-highspeed": {
    "id": "MiniMax-M2.7-highspeed",
    "extends": "MiniMax-M2.7",
    "overrides": {
      "name": "MiniMax M2.7 Highspeed"
    },
    "releasedAt": "2026-03-18",
    "creatorId": "minimax"
  },
  "MiniMax-M2.5": {
    "id": "MiniMax-M2.5",
    "extends": "MiniMax-M2.7",
    "overrides": {
      "name": "MiniMax M2.5"
    },
    "creatorId": "minimax"
  },
  "MiniMax-M2.5-highspeed": {
    "id": "MiniMax-M2.5-highspeed",
    "extends": "MiniMax-M2.7",
    "overrides": {
      "name": "MiniMax M2.5 Highspeed"
    },
    "creatorId": "minimax"
  },
  "mistral-ocr-4-1": {
    "id": "mistral-ocr-4-1",
    "name": "Mistral OCR 4.1",
    "license": "proprietary",
    "capabilities": [
      "img-in",
      "txt-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": null,
      "maxOutput": null
    },
    "aliases": [
      "mistral-ocr-4",
      "mistral-ocr-latest"
    ],
    "releasedAt": "2026-07-16",
    "creatorId": "mistral"
  },
  "mistral-ocr-4-0": {
    "id": "mistral-ocr-4-0",
    "name": "Mistral OCR 4",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": null,
      "maxOutput": null
    },
    "releasedAt": "2026-06-23",
    "creatorId": "mistral"
  },
  "mistral-medium-3-5": {
    "id": "mistral-medium-3-5",
    "name": "Mistral Medium 3.5",
    "license": "modified-mit",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 256e3,
      "maxOutput": null
    },
    "releasedAt": "2026-04-28",
    "creatorId": "mistral"
  },
  "mistral-small-2603": {
    "id": "mistral-small-2603",
    "name": "Mistral Small 4",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 256e3,
      "maxOutput": null
    },
    "releasedAt": "2026-03-16",
    "creatorId": "mistral"
  },
  "mistral-large-2512": {
    "id": "mistral-large-2512",
    "name": "Mistral Large 3",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 256e3,
      "maxOutput": null
    },
    "releasedAt": "2025-12-02",
    "creatorId": "mistral"
  },
  "ministral-14b-2512": {
    "id": "ministral-14b-2512",
    "name": "Ministral 3 14B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 256e3,
      "maxOutput": null
    },
    "releasedAt": "2025-12-02",
    "creatorId": "mistral"
  },
  "ministral-8b-2512": {
    "id": "ministral-8b-2512",
    "extends": "ministral-14b-2512",
    "overrides": {
      "name": "Ministral 3 8B"
    },
    "releasedAt": "2025-12-02",
    "creatorId": "mistral"
  },
  "ministral-3b-2512": {
    "id": "ministral-3b-2512",
    "extends": "ministral-14b-2512",
    "overrides": {
      "name": "Ministral 3 3B"
    },
    "releasedAt": "2025-12-02",
    "creatorId": "mistral"
  },
  "voxtral-mini-transcribe-realtime-2602": {
    "id": "voxtral-mini-transcribe-realtime-2602",
    "name": "Voxtral Mini Transcribe Realtime",
    "license": "apache-2.0",
    "capabilities": [
      "audio-in",
      "txt-out"
    ],
    "context": {
      "type": "audio-in",
      "total": null,
      "maxOutput": null
    },
    "releasedAt": "2026-02-04",
    "creatorId": "mistral"
  },
  "voxtral-mini-tts-2603": {
    "id": "voxtral-mini-tts-2603",
    "name": "Voxtral TTS",
    "license": "cc-by-nc-4.0",
    "capabilities": [
      "txt-in",
      "audio-in",
      "audio-out"
    ],
    "context": {
      "type": "audio-out",
      "total": null,
      "maxOutput": null
    },
    "releasedAt": "2026-03-23",
    "creatorId": "mistral"
  },
  "mistral-medium-3-2025-05-07": {
    "id": "mistral-medium-3-2025-05-07",
    "name": "Mistral Medium 3",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 8192
    },
    "aliases": [
      "mistral-medium-3",
      "mistral-medium-2025"
    ],
    "creatorId": "mistral"
  },
  "mistral-large-2402": {
    "id": "mistral-large-2402",
    "name": "Mistral Large",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 32768,
      "maxOutput": 4096
    },
    "creatorId": "mistral"
  },
  "mistral-small-2402": {
    "id": "mistral-small-2402",
    "name": "Mistral Small",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 32768,
      "maxOutput": 4096
    },
    "creatorId": "mistral"
  },
  "mistral-medium": {
    "id": "mistral-medium",
    "name": "Mistral Medium",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 32768,
      "maxOutput": 4096
    },
    "creatorId": "mistral"
  },
  "open-mistral-7b": {
    "id": "open-mistral-7b",
    "name": "Open Mistral 7B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 32768,
      "maxOutput": 4096
    },
    "creatorId": "mistral"
  },
  "open-mixtral-8x7b": {
    "id": "open-mixtral-8x7b",
    "name": "Open Mixtral 8x7B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 32768,
      "maxOutput": 4096
    },
    "creatorId": "mistral"
  },
  "nvidia/nemotron-3.5-lightning-30b-a3b": {
    "id": "nvidia/nemotron-3.5-lightning-30b-a3b",
    "name": "NVIDIA Nemotron 3.5 Lightning 30B A3B",
    "license": "openmdw-1.1",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": null
    },
    "releasedAt": "2026-08-11",
    "creatorId": "nvidia"
  },
  "nvidia/nemotron-3-ultra-550b-a55b": {
    "id": "nvidia/nemotron-3-ultra-550b-a55b",
    "name": "NVIDIA Nemotron 3 Ultra 550B A55B",
    "license": "openmdw-1.1",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": null
    },
    "releasedAt": "2026-06-04",
    "creatorId": "nvidia"
  },
  "nvidia/nemotron-3-super-120b-a12b": {
    "id": "nvidia/nemotron-3-super-120b-a12b",
    "extends": "nvidia/nemotron-3-ultra-550b-a55b",
    "overrides": {
      "name": "NVIDIA Nemotron 3 Super 120B A12B",
      "license": "nvidia-nemotron-open-model"
    },
    "releasedAt": "2026-03-11",
    "creatorId": "nvidia"
  },
  "nvidia/nemotron-3-nano-30b-a3b": {
    "id": "nvidia/nemotron-3-nano-30b-a3b",
    "extends": "nvidia/nemotron-3-super-120b-a12b",
    "overrides": {
      "name": "NVIDIA Nemotron 3 Nano 30B A3B"
    },
    "releasedAt": "2025-12-15",
    "creatorId": "nvidia"
  },
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": {
    "id": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    "name": "NVIDIA Nemotron 3 Nano Omni 30B A3B Reasoning",
    "license": "nvidia-open-model",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 262144,
      "maxOutput": null
    },
    "releasedAt": "2026-04-28",
    "creatorId": "nvidia"
  },
  "gpt-live-1": {
    "id": "gpt-live-1",
    "name": "GPT-Live 1",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "audio-in",
      "audio-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": null,
      "maxOutput": null
    },
    "releasedAt": "2026-09-10",
    "creatorId": "openai"
  },
  "gpt-6-astra": {
    "id": "gpt-6-astra",
    "name": "GPT-6 Astra",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 105e4,
      "maxOutput": 128e3
    },
    "releasedAt": "2026-09-03",
    "creatorId": "openai"
  },
  "gpt-image-2.5-sunburst": {
    "id": "gpt-image-2.5-sunburst",
    "name": "GPT Image 2.5 Sunburst",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "img-out"
    ],
    "context": {
      "maxOutput": 10,
      "sizes": [
        "1024x1024",
        "1536x1024",
        "1024x1536"
      ],
      "qualities": [
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "auto"
      ]
    },
    "aliases": [
      "gpt-image-2.5-sunburst-2026-09-08"
    ],
    "releasedAt": "2026-09-08",
    "creatorId": "openai"
  },
  "gpt-image-2.5-flare": {
    "id": "gpt-image-2.5-flare",
    "extends": "gpt-image-2.5-sunburst",
    "overrides": {
      "name": "GPT Image 2.5 Flare",
      "aliases": [
        "gpt-image-2.5-flare-2026-09-08"
      ]
    },
    "releasedAt": "2026-09-08",
    "creatorId": "openai"
  },
  "gpt-5.6-cyber": {
    "id": "gpt-5.6-cyber",
    "name": "GPT-5.6 Cyber",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 4e5,
      "maxOutput": 128e3
    },
    "aliases": [
      "daybreak-red-latest"
    ],
    "releasedAt": "2026-08-07",
    "creatorId": "openai"
  },
  "gpt-5.6-sol": {
    "id": "gpt-5.6-sol",
    "name": "GPT-5.6 Sol",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 105e4,
      "maxOutput": 128e3
    },
    "aliases": [
      "gpt-5.6",
      "daybreak-blue-latest"
    ],
    "releasedAt": "2026-06-26",
    "creatorId": "openai"
  },
  "gpt-5.6-terra": {
    "id": "gpt-5.6-terra",
    "extends": "gpt-5.6-sol",
    "overrides": {
      "name": "GPT-5.6 Terra"
    },
    "releasedAt": "2026-06-26",
    "creatorId": "openai"
  },
  "gpt-5.6-luna": {
    "id": "gpt-5.6-luna",
    "extends": "gpt-5.6-sol",
    "overrides": {
      "name": "GPT-5.6 Luna"
    },
    "releasedAt": "2026-06-26",
    "creatorId": "openai"
  },
  "gpt-5.5": {
    "id": "gpt-5.5",
    "name": "GPT-5.5",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 105e4,
      "maxOutput": 128e3
    },
    "aliases": [
      "gpt-5.5-2026-04-23"
    ],
    "releasedAt": "2026-04-23",
    "creatorId": "openai"
  },
  "gpt-5.5-pro": {
    "id": "gpt-5.5-pro",
    "extends": "gpt-5.5",
    "overrides": {
      "name": "GPT-5.5 Pro",
      "aliases": [
        "gpt-5.5-pro-2026-04-23"
      ]
    },
    "releasedAt": "2026-04-23",
    "creatorId": "openai"
  },
  "gpt-5.3-codex": {
    "id": "gpt-5.3-codex",
    "name": "GPT-5.3-Codex",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 4e5,
      "maxOutput": 128e3
    },
    "releasedAt": "2026-02-05",
    "creatorId": "openai"
  },
  "gpt-5": {
    "id": "gpt-5",
    "name": "GPT-5",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 4e5,
      "maxOutput": 65536
    },
    "aliases": [
      "gpt-5-2025-08-07",
      "gpt-5-latest"
    ],
    "creatorId": "openai"
  },
  "gpt-5.1": {
    "id": "gpt-5.1",
    "name": "GPT-5.1",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 6e5,
      "maxOutput": 131072
    },
    "aliases": [
      "gpt-5.1-latest",
      "gpt-5.1-2025-11-01"
    ],
    "creatorId": "openai"
  },
  "gpt-5.2": {
    "id": "gpt-5.2",
    "extends": "gpt-5.1",
    "overrides": {
      "name": "GPT-5.2",
      "aliases": [
        "gpt-5.2-latest",
        "gpt-5.2-chat-latest"
      ]
    },
    "creatorId": "openai"
  },
  "gpt-5.2-pro": {
    "id": "gpt-5.2-pro",
    "name": "GPT-5.2 Pro",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 4e5,
      "maxOutput": 128e3
    },
    "aliases": [
      "gpt-5.2-pro-2025-12-11"
    ],
    "creatorId": "openai"
  },
  "gpt-5-pro": {
    "id": "gpt-5-pro",
    "name": "GPT-5 Pro",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 4e5,
      "maxOutput": 272e3
    },
    "aliases": [
      "gpt-5-pro-2025-10-06"
    ],
    "creatorId": "openai"
  },
  "gpt-5.4": {
    "id": "gpt-5.4",
    "name": "GPT-5.4",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 105e4,
      "maxOutput": 128e3
    },
    "aliases": [
      "gpt-5.4-2026-03-05"
    ],
    "creatorId": "openai"
  },
  "gpt-5.4-pro": {
    "id": "gpt-5.4-pro",
    "name": "GPT-5.4 Pro",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 105e4,
      "maxOutput": 128e3
    },
    "aliases": [
      "gpt-5.4-pro-2026-03-05"
    ],
    "creatorId": "openai"
  },
  "gpt-5.4-mini": {
    "id": "gpt-5.4-mini",
    "extends": "gpt-5.4",
    "overrides": {
      "name": "GPT-5.4 Mini",
      "context": {
        "type": "token",
        "total": 4e5,
        "maxOutput": 128e3
      },
      "aliases": [
        "gpt-5.4-mini-2026-03-17"
      ]
    },
    "creatorId": "openai"
  },
  "gpt-5.4-nano": {
    "id": "gpt-5.4-nano",
    "extends": "gpt-5.4",
    "overrides": {
      "name": "GPT-5.4 Nano",
      "context": {
        "type": "token",
        "total": 4e5,
        "maxOutput": 128e3
      },
      "aliases": [
        "gpt-5.4-nano-2026-03-17"
      ]
    },
    "creatorId": "openai"
  },
  "gpt-4o": {
    "id": "gpt-4o",
    "name": "GPT-4o",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 128e3,
      "maxOutput": 16384
    },
    "aliases": [
      "chatgpt-4o-latest",
      "gpt-4o-2024-08-06"
    ],
    "creatorId": "openai"
  },
  "gpt-5-nano": {
    "id": "gpt-5-nano",
    "name": "GPT-5 Nano",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 16384
    },
    "aliases": [
      "gpt-5-nano-latest"
    ],
    "creatorId": "openai"
  },
  "gpt-5-mini": {
    "id": "gpt-5-mini",
    "name": "GPT-5 Mini",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 4e5,
      "maxOutput": 128e3
    },
    "aliases": [
      "gpt-5-mini-latest"
    ],
    "creatorId": "openai"
  },
  "gpt-oss-120b": {
    "id": "gpt-oss-120b",
    "name": "GPT OSS 120B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 65536
    },
    "creatorId": "openai"
  },
  "gpt-oss-20b": {
    "id": "gpt-oss-20b",
    "name": "GPT OSS 20B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 65536
    },
    "creatorId": "openai"
  },
  "gpt-transcribe": {
    "id": "gpt-transcribe",
    "name": "GPT Transcribe",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "txt-out",
      "audio-in"
    ],
    "context": {
      "type": "audio-in",
      "total": null,
      "maxOutput": null
    },
    "releasedAt": "2026-07-28",
    "creatorId": "openai"
  },
  "gpt-live-transcribe": {
    "id": "gpt-live-transcribe",
    "extends": "gpt-transcribe",
    "overrides": {
      "name": "GPT Live Transcribe"
    },
    "releasedAt": "2026-07-28",
    "creatorId": "openai"
  },
  "whisper-1": {
    "id": "whisper-1",
    "name": "Whisper",
    "license": "proprietary",
    "capabilities": [
      "audio-in",
      "txt-out"
    ],
    "context": {
      "type": "audio-in",
      "total": null,
      "maxOutput": null
    },
    "creatorId": "openai"
  },
  "tts-1": {
    "id": "tts-1",
    "name": "TTS-1",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "audio-out"
    ],
    "context": {
      "type": "audio-out",
      "total": null,
      "maxOutput": null
    },
    "creatorId": "openai"
  },
  "tts-1-hd": {
    "id": "tts-1-hd",
    "extends": "tts-1",
    "overrides": {
      "name": "TTS-1 HD"
    },
    "creatorId": "openai"
  },
  "gpt-realtime-1.5": {
    "id": "gpt-realtime-1.5",
    "name": "GPT Realtime 1.5",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "audio-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 32e3,
      "maxOutput": 4096
    },
    "creatorId": "openai"
  },
  "gpt-realtime-2": {
    "id": "gpt-realtime-2",
    "name": "GPT Realtime 2",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "audio-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 128e3,
      "maxOutput": 32e3
    },
    "creatorId": "openai"
  },
  "gpt-realtime-2.1": {
    "id": "gpt-realtime-2.1",
    "extends": "gpt-realtime-2",
    "overrides": {
      "name": "GPT Realtime 2.1"
    },
    "creatorId": "openai"
  },
  "gpt-realtime-2.1-mini": {
    "id": "gpt-realtime-2.1-mini",
    "extends": "gpt-realtime-2.1",
    "overrides": {
      "name": "GPT Realtime 2.1 Mini"
    },
    "creatorId": "openai"
  },
  "gpt-realtime-mini": {
    "id": "gpt-realtime-mini",
    "name": "GPT Realtime Mini",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "audio-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 32e3,
      "maxOutput": 4096
    },
    "aliases": [
      "gpt-realtime-mini-2025-12-15"
    ],
    "creatorId": "openai"
  },
  "gpt-realtime-translate": {
    "id": "gpt-realtime-translate",
    "name": "GPT Realtime Translate",
    "license": "proprietary",
    "capabilities": [
      "txt-out",
      "audio-in",
      "audio-out"
    ],
    "context": {
      "type": "token",
      "total": 16e3,
      "maxOutput": 2e3
    },
    "creatorId": "openai"
  },
  "gpt-realtime-whisper": {
    "id": "gpt-realtime-whisper",
    "name": "GPT Realtime Whisper",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "txt-out",
      "audio-in"
    ],
    "context": {
      "type": "token",
      "total": 16e3,
      "maxOutput": 2e3
    },
    "creatorId": "openai"
  },
  "gpt-audio-1.5": {
    "id": "gpt-audio-1.5",
    "name": "GPT Audio 1.5",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "audio-in",
      "audio-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 128e3,
      "maxOutput": 16384
    },
    "creatorId": "openai"
  },
  "dall-e-2": {
    "id": "dall-e-2",
    "name": "DALL-E 2",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-out"
    ],
    "context": {
      "maxOutput": 1,
      "sizes": [
        "256x256",
        "512x512",
        "1024x1024"
      ],
      "qualities": [
        "standard"
      ]
    },
    "creatorId": "openai"
  },
  "dall-e-3": {
    "id": "dall-e-3",
    "name": "DALL-E 3",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-out"
    ],
    "context": {
      "maxOutput": 1,
      "sizes": [
        "1024x1024",
        "1024x1792",
        "1792x1024"
      ],
      "qualities": [
        "standard",
        "hd"
      ]
    },
    "creatorId": "openai"
  },
  "text-embedding-ada-002": {
    "id": "text-embedding-ada-002",
    "name": "Text Embedding Ada 002",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "vec-out"
    ],
    "context": {
      "type": "embedding",
      "total": 8191,
      "unit": "tokens",
      "dimensions": 1536,
      "embeddingType": "text",
      "normalized": true
    },
    "creatorId": "openai"
  },
  "text-embedding-3-small": {
    "id": "text-embedding-3-small",
    "name": "Text Embedding 3 Small",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "vec-out"
    ],
    "context": {
      "type": "embedding",
      "total": 8191,
      "unit": "tokens",
      "dimensions": 1536,
      "embeddingType": "text",
      "normalized": true
    },
    "creatorId": "openai"
  },
  "text-embedding-3-large": {
    "id": "text-embedding-3-large",
    "name": "Text Embedding 3 Large",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "vec-out"
    ],
    "context": {
      "type": "embedding",
      "total": 8191,
      "unit": "tokens",
      "dimensions": 3072,
      "embeddingType": "text",
      "normalized": true
    },
    "creatorId": "openai"
  },
  "o4-mini": {
    "id": "o4-mini",
    "name": "OpenAI o4 Mini",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 2e5,
      "maxOutput": 1e5
    },
    "creatorId": "openai"
  },
  "o4-mini-2025-04-16": {
    "id": "o4-mini-2025-04-16",
    "name": "OpenAI o4 Mini",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 2e5,
      "maxOutput": 1e5
    },
    "aliases": [],
    "creatorId": "openai"
  },
  "computer-use-preview-2025-03-11": {
    "id": "computer-use-preview-2025-03-11",
    "name": "Computer Use Preview",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 128e3,
      "maxOutput": 16384
    },
    "aliases": [
      "computer-use-preview"
    ],
    "creatorId": "openai"
  },
  "gpt-image-1": {
    "id": "gpt-image-1",
    "name": "GPT Image 1",
    "license": "proprietary",
    "capabilities": [
      "img-in",
      "img-out"
    ],
    "context": {
      "maxOutput": 1,
      "sizes": [
        "1024x1024",
        "1792x1024",
        "1024x1792"
      ],
      "qualities": [
        "standard",
        "hd"
      ]
    },
    "creatorId": "openai"
  },
  "gpt-image-1.5": {
    "id": "gpt-image-1.5",
    "name": "GPT Image 1.5",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "txt-out",
      "img-in",
      "img-out"
    ],
    "context": {
      "maxOutput": 1,
      "sizes": [
        "1024x1024",
        "1024x1536",
        "1536x1024"
      ],
      "qualities": [
        "low",
        "medium",
        "high"
      ]
    },
    "aliases": [
      "gpt-image-1.5-2025-12-16"
    ],
    "creatorId": "openai"
  },
  "gpt-image-2": {
    "id": "gpt-image-2",
    "name": "GPT Image 2",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "img-out"
    ],
    "context": {
      "maxOutput": 1,
      "sizes": [
        "1024x1024",
        "1024x1536",
        "1536x1024"
      ],
      "qualities": [
        "low",
        "medium",
        "high"
      ]
    },
    "aliases": [
      "gpt-image-2-2026-04-21"
    ],
    "releasedAt": "2026-04-21",
    "creatorId": "openai"
  },
  "gpt-image-1-mini": {
    "id": "gpt-image-1-mini",
    "extends": "gpt-image-1.5",
    "overrides": {
      "name": "GPT Image 1 Mini"
    },
    "creatorId": "openai"
  },
  "omni-moderation-2024-09-26": {
    "id": "omni-moderation-2024-09-26",
    "name": "Omni Moderation",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "txt-out"
    ],
    "context": {
      "type": "token",
      "total": 32e3
    },
    "aliases": [
      "omni-moderation-latest"
    ],
    "creatorId": "openai"
  },
  "qwen3.8-max": {
    "id": "qwen3.8-max",
    "name": "Qwen 3.8 Max",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason",
      "video-in"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": null
    },
    "creatorId": "qwen"
  },
  "qwen3.8-max-0902": {
    "id": "qwen3.8-max-0902",
    "extends": "qwen3.8-max",
    "overrides": {
      "name": "Qwen 3.8 Max 0902"
    },
    "creatorId": "qwen"
  },
  "qwen3.8-flash": {
    "id": "qwen3.8-flash",
    "name": "Qwen 3.8 Flash",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason",
      "video-in"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": null
    },
    "creatorId": "qwen"
  },
  "Qwen/Qwen3.8-27B": {
    "id": "Qwen/Qwen3.8-27B",
    "name": "Qwen3.8 27B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "video-in",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 262144,
      "maxOutput": null
    },
    "creatorId": "qwen"
  },
  "Qwen/Qwen3.8-Flash-Next": {
    "id": "Qwen/Qwen3.8-Flash-Next",
    "extends": "Qwen/Qwen3.8-27B",
    "overrides": {
      "name": "Qwen3.8 Flash Next",
      "license": "qwen-community-1.0"
    },
    "creatorId": "qwen"
  },
  "qwen3.8-max-preview": {
    "id": "qwen3.8-max-preview",
    "name": "Qwen 3.8 Max Preview",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": null
    },
    "creatorId": "qwen"
  },
  "Qwen/Qwen3.8-2.4T-A95B": {
    "id": "Qwen/Qwen3.8-2.4T-A95B",
    "name": "Qwen3.8 2.4T A95B",
    "license": "qwen3.8-max",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 262144,
      "maxOutput": null
    },
    "releasedAt": "2026-08-12",
    "creatorId": "qwen"
  },
  "qwen3.7-max": {
    "id": "qwen3.7-max",
    "name": "Qwen 3.7 Max",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": 64e3
    },
    "aliases": [
      "qwen3.7-max-preview",
      "qwen3.7-max-2026-06-08"
    ],
    "creatorId": "qwen"
  },
  "qwen3.7-plus": {
    "id": "qwen3.7-plus",
    "name": "Qwen 3.7 Plus",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": 64e3
    },
    "aliases": [
      "qwen3.7-plus-2026-05-26"
    ],
    "creatorId": "qwen"
  },
  "qwen3.6-plus": {
    "id": "qwen3.6-plus",
    "extends": "qwen3.7-plus",
    "overrides": {
      "name": "Qwen 3.6 Plus",
      "aliases": [
        "qwen3.6-plus-2026-04-02"
      ]
    },
    "creatorId": "qwen"
  },
  "qwen3.6-flash": {
    "id": "qwen3.6-flash",
    "extends": "qwen3.7-plus",
    "overrides": {
      "name": "Qwen 3.6 Flash",
      "aliases": [
        "qwen3.6-flash-2026-04-16"
      ]
    },
    "creatorId": "qwen"
  },
  "qwen3-max": {
    "id": "qwen3-max",
    "name": "Qwen3 Max",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 262144,
      "maxOutput": 65536
    },
    "aliases": [
      "qwen3-max-2026-01-23"
    ],
    "creatorId": "qwen"
  },
  "qwen3.5-plus": {
    "id": "qwen3.5-plus",
    "name": "Qwen3.5 Plus",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": 65536
    },
    "aliases": [
      "qwen3.5-plus-2026-02-15"
    ],
    "creatorId": "qwen"
  },
  "qwen3.5-flash": {
    "id": "qwen3.5-flash",
    "name": "Qwen3.5 Flash",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": 65536
    },
    "aliases": [
      "qwen3.5-flash-2026-02-23"
    ],
    "creatorId": "qwen"
  },
  "qwen3-next-80b-a3b-thinking": {
    "id": "qwen3-next-80b-a3b-thinking",
    "name": "Qwen3 Next 80B A3B Thinking",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 32768
    },
    "creatorId": "qwen"
  },
  "qwen3-next-80b-a3b-instruct": {
    "id": "qwen3-next-80b-a3b-instruct",
    "name": "Qwen3 Next 80B A3B Instruct",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 32768
    },
    "creatorId": "qwen"
  },
  "qwen3-coder-next": {
    "id": "qwen3-coder-next",
    "name": "Qwen3 Coder Next",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 262144,
      "maxOutput": 65536
    },
    "creatorId": "qwen"
  },
  "qwen3-coder-plus": {
    "id": "qwen3-coder-plus",
    "name": "Qwen3 Coder Plus",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": 65536
    },
    "aliases": [
      "qwen3-coder-plus-2025-09-23"
    ],
    "creatorId": "qwen"
  },
  "qwen3-vl-plus": {
    "id": "qwen3-vl-plus",
    "name": "Qwen3 VL Plus",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 262144,
      "maxOutput": 32768
    },
    "aliases": [
      "qwen3-vl-plus-2025-12-19"
    ],
    "creatorId": "qwen"
  },
  "qwen3-vl-flash": {
    "id": "qwen3-vl-flash",
    "name": "Qwen3 VL Flash",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "video-in",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 262144,
      "maxOutput": 32768
    },
    "aliases": [
      "qwen3-vl-flash-2026-01-22"
    ],
    "creatorId": "qwen"
  },
  "qwen3-235b-a22b": {
    "id": "qwen3-235b-a22b",
    "name": "Qwen3 235B A22B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 16384
    },
    "aliases": [
      "qwen3-235b-a22b-instruct-2507",
      "qwen3-235b-a22b-thinking-2507"
    ],
    "creatorId": "qwen"
  },
  "qwen3-32b": {
    "id": "qwen3-32b",
    "name": "Qwen3 32B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 8192
    },
    "creatorId": "qwen"
  },
  "qwen3-30b-a3b": {
    "id": "qwen3-30b-a3b",
    "name": "Qwen3 30B A3B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 8192
    },
    "aliases": [
      "qwen3-30b-a3b-instruct-2507",
      "qwen3-30b-a3b-thinking-2507"
    ],
    "creatorId": "qwen"
  },
  "qwen3-14b": {
    "id": "qwen3-14b",
    "name": "Qwen3 14B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 8192
    },
    "creatorId": "qwen"
  },
  "qwen3-8b": {
    "id": "qwen3-8b",
    "name": "Qwen3 8B",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 8192
    },
    "creatorId": "qwen"
  },
  "stepaudio-2.5-chat": {
    "id": "stepaudio-2.5-chat",
    "name": "StepAudio 2.5 Chat",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "audio-in"
    ],
    "context": {
      "type": "token",
      "total": null,
      "maxOutput": null
    },
    "creatorId": "stepfun"
  },
  "stepaudio-2.5-realtime": {
    "id": "stepaudio-2.5-realtime",
    "name": "StepAudio 2.5 Realtime",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "audio-in",
      "audio-out"
    ],
    "context": {
      "type": "audio-in",
      "total": null,
      "maxOutput": null
    },
    "creatorId": "stepfun"
  },
  "stepaudio-2.5-tts": {
    "id": "stepaudio-2.5-tts",
    "name": "StepAudio 2.5 TTS",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "audio-out"
    ],
    "context": {
      "type": "character",
      "total": 1e3,
      "maxOutput": null
    },
    "creatorId": "stepfun"
  },
  "stepaudio-2.5-asr": {
    "id": "stepaudio-2.5-asr",
    "name": "StepAudio 2.5 ASR",
    "license": "proprietary",
    "capabilities": [
      "audio-in",
      "txt-out"
    ],
    "context": {
      "type": "audio-in",
      "total": null,
      "maxOutput": null
    },
    "creatorId": "stepfun"
  },
  "step-3.7-flash": {
    "id": "step-3.7-flash",
    "name": "Step 3.7 Flash",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 262144,
      "maxOutput": null
    },
    "releasedAt": "2026-05-29",
    "creatorId": "stepfun"
  },
  "hy4-preview": {
    "id": "hy4-preview",
    "name": "Tencent Hy4 Preview",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 65536
    },
    "releasedAt": "2026-08-28",
    "creatorId": "tencent"
  },
  "hy3": {
    "id": "hy3",
    "name": "Tencent Hy3",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 262144,
      "maxOutput": 131072
    },
    "releasedAt": "2026-07-06",
    "creatorId": "tencent"
  },
  "hy3-preview": {
    "id": "hy3-preview",
    "extends": "hy3",
    "overrides": {
      "name": "Tencent Hy3 Preview"
    },
    "releasedAt": "2026-04-23",
    "creatorId": "tencent"
  },
  "thinkingmachines/Inkling-Small": {
    "id": "thinkingmachines/Inkling-Small",
    "name": "Inkling-Small",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": null
    },
    "releasedAt": "2026-07-30",
    "creatorId": "thinkingmachines"
  },
  "thinkingmachines/Inkling": {
    "id": "thinkingmachines/Inkling",
    "name": "Inkling",
    "license": "apache-2.0",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "audio-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": null
    },
    "releasedAt": "2026-07-15",
    "creatorId": "thinkingmachines"
  },
  "grok-imagine-image-2.0": {
    "id": "grok-imagine-image-2.0",
    "name": "Grok Imagine Image 2.0",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "img-out"
    ],
    "context": {
      "maxOutput": 10,
      "sizes": [
        "1k",
        "2k"
      ],
      "qualities": [
        "low",
        "medium",
        "auto"
      ]
    },
    "creatorId": "xai"
  },
  "grok-4.6": {
    "id": "grok-4.6",
    "name": "Grok 4.6",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "reason",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 5e5,
      "maxOutput": null
    },
    "releasedAt": "2026-08-12",
    "creatorId": "xai"
  },
  "grok-voice-think-fast-2.0": {
    "id": "grok-voice-think-fast-2.0",
    "name": "Grok Voice Think Fast 2.0",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "audio-in",
      "audio-out",
      "reason",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": null,
      "maxOutput": null
    },
    "aliases": [
      "grok-voice-latest"
    ],
    "releasedAt": "2026-07-29",
    "creatorId": "xai"
  },
  "grok-4.5": {
    "id": "grok-4.5",
    "name": "Grok 4.5",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "reason",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 5e5,
      "maxOutput": null
    },
    "aliases": [
      "grok-4.5-latest"
    ],
    "releasedAt": "2026-07-08",
    "creatorId": "xai"
  },
  "grok-4.3": {
    "id": "grok-4.3",
    "name": "Grok 4.3",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "reason",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": null
    },
    "aliases": [
      "grok-4.3-latest",
      "grok-latest"
    ],
    "creatorId": "xai"
  },
  "grok-voice-think-fast-1.0": {
    "id": "grok-voice-think-fast-1.0",
    "name": "Grok Voice Think Fast 1.0",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "audio-in",
      "audio-out",
      "reason",
      "fn-out"
    ],
    "context": {
      "type": "token",
      "total": null,
      "maxOutput": null
    },
    "releasedAt": "2026-04-23",
    "creatorId": "xai"
  },
  "grok-build-0.1": {
    "id": "grok-build-0.1",
    "name": "Grok Build 0.1",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "reason",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 256e3,
      "maxOutput": null
    },
    "releasedAt": "2026-05-19",
    "creatorId": "xai"
  },
  "grok-3-beta": {
    "id": "grok-3-beta",
    "name": "Grok 3 Beta",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "reason",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 131072
    },
    "aliases": [
      "grok-3",
      "grok-3-latest"
    ],
    "releasedAt": "2025-02-18",
    "creatorId": "xai"
  },
  "grok-3-fast-beta": {
    "id": "grok-3-fast-beta",
    "name": "Grok 3 Beta (Fast mode)",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "reason",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 131072
    },
    "releasedAt": "2025-02-18",
    "creatorId": "xai"
  },
  "grok-3-mini-beta": {
    "id": "grok-3-mini-beta",
    "name": "Grok 3 Mini Beta",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "reason",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 131072
    },
    "aliases": [
      "grok-3-mini",
      "grok-3-mini-latest"
    ],
    "releasedAt": "2025-02-18",
    "creatorId": "xai"
  },
  "grok-3-mini-fast-beta": {
    "id": "grok-3-mini-fast-beta",
    "name": "Grok 3 Mini Beta (Fast mode)",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "reason",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 131072
    },
    "releasedAt": "2025-02-18",
    "creatorId": "xai"
  },
  "grok-2-vision-1212": {
    "id": "grok-2-vision-1212",
    "name": "Grok 2 Vision",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 32768,
      "maxOutput": 32768
    },
    "aliases": [
      "grok-2-vision",
      "grok-2-vision-latest"
    ],
    "releasedAt": "2024-12-12",
    "creatorId": "xai"
  },
  "grok-2-1212": {
    "id": "grok-2-1212",
    "name": "Grok 2",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 131072
    },
    "aliases": [
      "grok-2",
      "grok-2-latest"
    ],
    "releasedAt": "2024-12-12",
    "creatorId": "xai"
  },
  "grok-vision-beta": {
    "id": "grok-vision-beta",
    "name": "Grok Vision Beta",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 8192,
      "maxOutput": 8192
    },
    "creatorId": "xai"
  },
  "grok-beta": {
    "id": "grok-beta",
    "name": "Grok Beta",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 4096
    },
    "creatorId": "xai"
  },
  "grok-4": {
    "id": "grok-4",
    "name": "Grok 4",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "reason",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 65536
    },
    "aliases": [
      "grok-4-2025-07-09",
      "grok-4-latest"
    ],
    "creatorId": "xai"
  },
  "grok-4-heavy": {
    "id": "grok-4-heavy",
    "name": "Grok 4 Heavy",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "reason",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 131072,
      "maxOutput": 65536
    },
    "aliases": [
      "grok-4-heavy-2025-07-09",
      "grok-4-heavy-latest"
    ],
    "creatorId": "xai"
  },
  "grok-code-fast-1": {
    "id": "grok-code-fast-1",
    "name": "Grok Code Fast 1",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "reason",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 256e3,
      "maxOutput": 1e4
    },
    "releasedAt": "2025-08-28",
    "creatorId": "xai"
  },
  "grok-4-fast": {
    "id": "grok-4-fast",
    "name": "Grok 4 Fast",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "reason",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 2e6,
      "maxOutput": 3e4
    },
    "releasedAt": "2025-09-19",
    "creatorId": "xai"
  },
  "grok-4-fast-non-reasoning": {
    "id": "grok-4-fast-non-reasoning",
    "name": "Grok 4 Fast (Non-Reasoning)",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 2e6,
      "maxOutput": 3e4
    },
    "releasedAt": "2025-09-19",
    "creatorId": "xai"
  },
  "grok-4-1-fast": {
    "id": "grok-4-1-fast",
    "name": "Grok 4.1 Fast",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "reason",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 2e6,
      "maxOutput": 3e4
    },
    "releasedAt": "2025-11-19",
    "creatorId": "xai"
  },
  "grok-4-1-fast-non-reasoning": {
    "id": "grok-4-1-fast-non-reasoning",
    "name": "Grok 4.1 Fast (Non-Reasoning)",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 2e6,
      "maxOutput": 3e4
    },
    "releasedAt": "2025-11-19",
    "creatorId": "xai"
  },
  "grok-4.20-0309-reasoning": {
    "id": "grok-4.20-0309-reasoning",
    "name": "Grok 4.20",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "reason",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": null
    },
    "aliases": [
      "grok-4.20",
      "grok-4.20-reasoning",
      "grok-4.20-reasoning-latest",
      "grok-4.20-beta-latest"
    ],
    "releasedAt": "2026-03-10",
    "creatorId": "xai"
  },
  "grok-4.20-0309-non-reasoning": {
    "id": "grok-4.20-0309-non-reasoning",
    "name": "Grok 4.20 (Non-Reasoning)",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": null
    },
    "aliases": [
      "grok-4.20-non-reasoning",
      "grok-4.20-non-reasoning-latest",
      "grok-4.20-beta-latest-non-reasoning"
    ],
    "releasedAt": "2026-03-10",
    "creatorId": "xai"
  },
  "grok-4.20-multi-agent-0309": {
    "id": "grok-4.20-multi-agent-0309",
    "name": "Grok 4.20 Multi-Agent Beta",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "reason",
      "fn-out",
      "json-out"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": null
    },
    "aliases": [
      "grok-4.20-multi-agent",
      "grok-4.20-multi-agent-latest",
      "grok-4.20-multi-agent-beta-0309"
    ],
    "releasedAt": "2026-03-09",
    "creatorId": "xai"
  },
  "grok-imagine-image": {
    "id": "grok-imagine-image",
    "name": "Grok Imagine Image",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "img-out"
    ],
    "context": {
      "maxOutput": 10,
      "sizes": [
        "1k",
        "2k"
      ]
    },
    "aliases": [
      "grok-imagine-image-2026-03-02"
    ],
    "releasedAt": "2026-01-28",
    "creatorId": "xai"
  },
  "grok-imagine-image-quality": {
    "id": "grok-imagine-image-quality",
    "extends": "grok-imagine-image",
    "overrides": {
      "name": "Grok Imagine Image Quality",
      "aliases": [
        "grok-imagine-image-quality-20260403",
        "grok-imagine-image-quality-latest",
        "grok-imagine-image-pro"
      ]
    },
    "releasedAt": "2026-05-06",
    "creatorId": "xai"
  },
  "grok-imagine-video": {
    "id": "grok-imagine-video",
    "name": "Grok Imagine Video",
    "license": "proprietary",
    "capabilities": [
      "txt-in",
      "img-in",
      "video-in",
      "video-out"
    ],
    "context": {
      "type": "token",
      "total": 15,
      "maxOutput": 15
    },
    "releasedAt": "2026-01-28",
    "creatorId": "xai"
  },
  "grok-imagine-video-1.5": {
    "id": "grok-imagine-video-1.5",
    "extends": "grok-imagine-video",
    "overrides": {
      "name": "Grok Imagine Video 1.5",
      "capabilities": [
        "txt-in",
        "img-in",
        "video-out"
      ],
      "aliases": [
        "grok-imagine-video-1.5-preview",
        "grok-imagine-video-1.5-2026-05-30"
      ]
    },
    "releasedAt": "2026-06-16",
    "creatorId": "xai"
  },
  "mimo-v2.5-pro": {
    "id": "mimo-v2.5-pro",
    "name": "Xiaomi MiMo-V2.5-Pro",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1048576,
      "maxOutput": 131072
    },
    "releasedAt": "2026-04-23",
    "creatorId": "xiaomi"
  },
  "mimo-v2.5": {
    "id": "mimo-v2.5",
    "extends": "mimo-v2.5-pro",
    "overrides": {
      "name": "Xiaomi MiMo-V2.5",
      "capabilities": [
        "chat",
        "txt-in",
        "txt-out",
        "img-in",
        "audio-in",
        "video-in",
        "json-out",
        "fn-out",
        "reason"
      ]
    },
    "releasedAt": "2026-04-23",
    "creatorId": "xiaomi"
  },
  "glm-5.3": {
    "id": "glm-5.3",
    "name": "GLM-5.3",
    "license": "glm-5.3",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": 128e3
    },
    "releasedAt": "2026-08-18",
    "creatorId": "zai"
  },
  "glm-5.3-flash": {
    "id": "glm-5.3-flash",
    "extends": "glm-5.3",
    "overrides": {
      "name": "GLM-5.3 Flash",
      "license": "mit",
      "capabilities": [
        "chat",
        "txt-in",
        "txt-out",
        "img-in",
        "json-out",
        "fn-out",
        "reason",
        "video-in"
      ]
    },
    "releasedAt": "2026-08-26",
    "creatorId": "zai"
  },
  "glm-5.2": {
    "id": "glm-5.2",
    "name": "GLM-5.2",
    "license": "mit",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "json-out",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 1e6,
      "maxOutput": 128e3
    },
    "releasedAt": "2026-06-16",
    "creatorId": "zai"
  },
  "glm-5.1": {
    "id": "glm-5.1",
    "extends": "glm-5.2",
    "overrides": {
      "name": "GLM-5.1",
      "context": {
        "type": "token",
        "total": 2e5,
        "maxOutput": 128e3
      }
    },
    "releasedAt": "2026-04-07",
    "creatorId": "zai"
  },
  "glm-5v-turbo": {
    "id": "glm-5v-turbo",
    "name": "GLM-5V-Turbo",
    "license": "proprietary",
    "capabilities": [
      "chat",
      "txt-in",
      "txt-out",
      "img-in",
      "video-in",
      "fn-out",
      "reason"
    ],
    "context": {
      "type": "token",
      "total": 2e5,
      "maxOutput": 128e3
    },
    "releasedAt": "2026-04-01",
    "creatorId": "zai"
  }
};
var providers = {
  "anthropic": {
    "id": "anthropic",
    "name": "Anthropic",
    "apiUrl": "https://api.anthropic.com/v1",
    "apiDocsUrl": "https://docs.anthropic.com/en/api",
    "pricing": {}
  },
  "aws": {
    "id": "aws",
    "name": "Amazon Web Services",
    "apiUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
    "apiDocsUrl": "https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html",
    "pricing": {}
  },
  "azure": {
    "id": "azure",
    "name": "Azure",
    "apiUrl": "",
    "apiDocsUrl": "https://learn.microsoft.com/en-us/azure/ai-services/openai/reference",
    "pricing": {}
  },
  "baidu": {
    "id": "baidu",
    "name": "Baidu Qianfan",
    "apiUrl": "https://api.baiduqianfan.ai/v1",
    "apiDocsUrl": "https://intl.cloud.baidu.com/en/doc/qianfan/s/7m95lyy43-intl-en",
    "pricing": {},
    "models": [
      {
        "creator": "baidu",
        "include": "all"
      },
      {
        "creator": "deepseek",
        "include": [
          "deepseek-v4-pro",
          "deepseek-v4-flash"
        ]
      }
    ]
  },
  "bedrock": {
    "id": "bedrock",
    "name": "AWS Bedrock",
    "apiUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
    "apiDocsUrl": "https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html",
    "pricing": {},
    "models": [
      {
        "creator": "aws",
        "include": "all"
      },
      {
        "creator": "anthropic",
        "include": [
          "claude-opus-5"
        ],
        "idOverrides": {
          "claude-opus-5": "anthropic.claude-opus-5"
        }
      }
    ]
  },
  "cohere": {
    "id": "cohere",
    "name": "Cohere",
    "apiUrl": "https://api.cohere.ai/v1",
    "apiDocsUrl": "https://docs.cohere.com/reference",
    "pricing": {},
    "models": [
      {
        "creator": "cohere",
        "include": "all",
        "exclude": [
          "CohereLabs/North-Micro-Vision-Instruct"
        ]
      }
    ]
  },
  "deepseek": {
    "id": "deepseek",
    "name": "DeepSeek",
    "apiUrl": "https://api.deepseek.com/v1",
    "apiDocsUrl": "https://platform.deepseek.com/docs",
    "pricing": {},
    "models": [
      {
        "creator": "deepseek",
        "include": "all",
        "exclude": [
          "deepseek-v4-flash",
          "deepseek-v4-flash-vision-exp"
        ]
      }
    ]
  },
  "google": {
    "id": "google",
    "name": "Google",
    "apiUrl": "https://generativelanguage.googleapis.com/v1",
    "apiDocsUrl": "https://ai.google.dev/docs",
    "pricing": {}
  },
  "groq": {
    "id": "groq",
    "name": "Groq",
    "apiUrl": "https://api.groq.com/openai/v1",
    "apiDocsUrl": "https://console.groq.com/docs/api-reference",
    "pricing": {},
    "models": [
      {
        "creator": "meta",
        "include": [
          "llama3-8b-8192",
          "llama3-70b-8192",
          "llama-guard-3-8b",
          "llama-3.1-8b-instant",
          "llama-3.3-70b-versatile",
          "meta-llama/llama-guard-4-12b",
          "meta-llama/llama-4-maverick-17b-128e-instruct",
          "meta-llama/llama-4-scout-17b-16e-instruct",
          "meta-llama/llama-prompt-guard-2-22m",
          "meta-llama/llama-prompt-guard-2-86m"
        ]
      },
      {
        "creator": "openai",
        "include": [
          "gpt-oss-120b",
          "gpt-oss-20b",
          "whisper-1"
        ]
      }
    ]
  },
  "kimi": {
    "id": "kimi",
    "name": "Moonshot AI",
    "apiUrl": "https://api.moonshot.ai/v1",
    "apiDocsUrl": "https://platform.moonshot.ai/docs",
    "pricing": {}
  },
  "meta": {
    "id": "meta",
    "name": "Meta Model API",
    "apiUrl": "https://api.meta.ai/v1",
    "apiDocsUrl": "https://dev.meta.ai/docs/",
    "pricing": {},
    "models": [
      {
        "creator": "meta",
        "include": [
          "muse-spark-1.3",
          "muse-image-1.0",
          "muse-voice-transcribe-1.0",
          "muse-spark-1.1",
          "muse-spark-1.2"
        ]
      }
    ]
  },
  "minimax": {
    "id": "minimax",
    "name": "MiniMax",
    "apiUrl": "https://api.minimax.io/v1",
    "apiDocsUrl": "https://platform.minimax.io/docs/api-reference/api-overview",
    "pricing": {}
  },
  "mistral": {
    "id": "mistral",
    "name": "Mistral",
    "apiUrl": "https://api.mistral.ai/v1",
    "apiDocsUrl": "https://docs.mistral.ai/",
    "pricing": {}
  },
  "nvidia": {
    "id": "nvidia",
    "name": "NVIDIA NIM",
    "apiUrl": "https://integrate.api.nvidia.com/v1",
    "apiDocsUrl": "https://docs.api.nvidia.com/nim/reference/llm-apis",
    "pricing": {}
  },
  "ollama": {
    "id": "ollama",
    "name": "Ollama"
  },
  "openai": {
    "id": "openai",
    "name": "OpenAI",
    "apiUrl": "https://api.openai.com/v1",
    "apiDocsUrl": "https://platform.openai.com/docs/api-reference",
    "pricing": {},
    "models": [
      {
        "creator": "openai",
        "include": "all",
        "exclude": [
          "gpt-oss-120b",
          "gpt-oss-20b"
        ]
      }
    ]
  },
  "openrouter": {
    "id": "openrouter",
    "name": "OpenRouter",
    "apiUrl": "https://openrouter.ai/api/v1",
    "apiDocsUrl": "https://openrouter.ai/docs/api",
    "pricing": {},
    "models": [
      {
        "creator": "openai",
        "include": [
          "gpt-6-astra",
          "gpt-5.6-sol",
          "gpt-5.6-terra",
          "gpt-5.6-luna",
          "gpt-5.5",
          "gpt-5.5-pro",
          "gpt-5.3-codex",
          "gpt-5",
          "gpt-5.1",
          "gpt-5.2",
          "gpt-5.2-pro",
          "gpt-5-pro",
          "gpt-5.4",
          "gpt-5.4-pro",
          "gpt-5.4-mini",
          "gpt-5.4-nano",
          "gpt-4o",
          "gpt-5-nano",
          "gpt-5-mini",
          "gpt-oss-120b",
          "gpt-oss-20b",
          "o4-mini"
        ],
        "idPrefix": "openai/"
      },
      {
        "creator": "anthropic",
        "include": [
          "claude-fable-5-1",
          "claude-opus-5",
          "claude-fable-5",
          "claude-sonnet-5",
          "claude-opus-4-8",
          "claude-opus-4-7",
          "claude-sonnet-4-5-20250929",
          "claude-haiku-4-5-20251001",
          "claude-opus-4-5-20251101",
          "claude-opus-4-6",
          "claude-opus-4-1-20250805",
          "claude-opus-4-20250514",
          "claude-sonnet-4-20250514",
          "claude-sonnet-4-6"
        ],
        "idPrefix": "anthropic/",
        "idOverrides": {
          "claude-fable-5-1": "anthropic/claude-fable-5.1",
          "claude-opus-4-8": "anthropic/claude-opus-4.8",
          "claude-opus-4-7": "anthropic/claude-opus-4.7",
          "claude-sonnet-4-5-20250929": "anthropic/claude-sonnet-4.5",
          "claude-haiku-4-5-20251001": "anthropic/claude-haiku-4.5",
          "claude-opus-4-5-20251101": "anthropic/claude-opus-4.5",
          "claude-opus-4-6": "anthropic/claude-opus-4.6",
          "claude-opus-4-1-20250805": "anthropic/claude-opus-4.1",
          "claude-opus-4-20250514": "anthropic/claude-opus-4",
          "claude-sonnet-4-20250514": "anthropic/claude-sonnet-4",
          "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6"
        }
      },
      {
        "creator": "google",
        "include": [
          "gemini-3.8-flash",
          "gemini-3.7-flash",
          "gemini-3.6-flash",
          "gemini-3.5-flash-lite",
          "gemini-3.5-flash",
          "gemini-3.1-flash-lite",
          "gemini-3-flash-preview",
          "gemini-3.1-pro-preview",
          "gemini-3-pro-image-preview",
          "gemini-3.1-flash-image-preview",
          "gemini-3.1-flash-image",
          "gemini-3.1-flash-lite-image",
          "gemini-3-pro-image",
          "lyria-3-clip-preview",
          "lyria-3-pro-preview",
          "gemini-2.5-pro",
          "gemini-2.5-pro-preview-06-05",
          "gemini-2.5-flash",
          "gemini-2.5-flash-lite",
          "gemini-3.1-flash-lite-preview",
          "gemma-3-4b-it",
          "gemma-3-12b-it",
          "gemma-3-27b-it",
          "gemini-2.5-flash-image"
        ],
        "idPrefix": "google/",
        "idOverrides": {
          "gemini-2.5-pro-preview-06-05": "google/gemini-2.5-pro-preview"
        }
      },
      {
        "creator": "meta",
        "include": [
          "muse-spark-1.1",
          "muse-spark-1.2",
          "muse-spark-1.3",
          "meta-models/Muse-Glimmer-30B"
        ],
        "idPrefix": "meta/",
        "idOverrides": {
          "meta-models/Muse-Glimmer-30B": "meta/muse-glimmer-30b"
        }
      },
      {
        "creator": "nvidia",
        "include": [
          "nvidia/nemotron-3.5-lightning-30b-a3b"
        ],
        "idOverrides": {
          "nvidia/nemotron-3.5-lightning-30b-a3b": "nvidia/nemotron-3.5-lightning"
        }
      },
      {
        "creator": "qwen",
        "include": [
          "qwen3.8-max-0902",
          "qwen3.8-flash",
          "Qwen/Qwen3.8-27B",
          "Qwen/Qwen3.8-2.4T-A95B"
        ],
        "idPrefix": "qwen/",
        "idOverrides": {
          "Qwen/Qwen3.8-27B": "qwen/qwen3.8-27b",
          "Qwen/Qwen3.8-2.4T-A95B": "qwen/qwen3.8-2.4t-a95b"
        }
      },
      {
        "creator": "deepseek",
        "include": [
          "deepseek-flash",
          "deepseek-v4-flash-vision-exp"
        ],
        "idPrefix": "deepseek/",
        "idOverrides": {
          "deepseek-flash": "deepseek/deepseek-v4.1-flash"
        }
      },
      {
        "creator": "zai",
        "include": [
          "glm-5.3",
          "glm-5.3-flash"
        ],
        "idPrefix": "z-ai/"
      },
      {
        "creator": "tencent",
        "include": [
          "hy4-preview"
        ],
        "idPrefix": "tencent/"
      },
      {
        "creator": "thinkingmachines",
        "include": [
          "thinkingmachines/Inkling-Small"
        ],
        "idOverrides": {
          "thinkingmachines/Inkling-Small": "thinkingmachines/inkling-small"
        }
      },
      {
        "creator": "xai",
        "include": [
          "grok-4.6"
        ],
        "idPrefix": "x-ai/"
      }
    ]
  },
  "oracle": {
    "id": "oracle",
    "name": "Oracle Cloud",
    "apiUrl": "https://ai.oraclecloud.com",
    "apiDocsUrl": "https://docs.oracle.com/en-us/iaas/Content/generative-ai/overview.htm",
    "pricing": {}
  },
  "qwen": {
    "id": "qwen",
    "name": "Qwen",
    "apiUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "apiDocsUrl": "https://help.aliyun.com/zh/model-studio/developer-reference/",
    "pricing": {},
    "models": [
      {
        "creator": "qwen",
        "include": "all",
        "exclude": [
          "Qwen/Qwen3.8-2.4T-A95B",
          "Qwen/Qwen3.8-27B",
          "Qwen/Qwen3.8-Flash-Next"
        ]
      }
    ]
  },
  "stepfun": {
    "id": "stepfun",
    "name": "StepFun",
    "apiUrl": "https://api.stepfun.ai/v1",
    "apiDocsUrl": "https://platform.stepfun.com/docs/zh/api-reference/chat/chat-completion-create",
    "pricing": {}
  },
  "tencent": {
    "id": "tencent",
    "name": "Tencent TokenHub",
    "apiUrl": "https://tokenhub.tencentmaas.com/v1",
    "apiDocsUrl": "https://cloud.tencent.com/document/product/1823/130078",
    "pricing": {},
    "models": [
      {
        "creator": "tencent",
        "include": "all"
      },
      {
        "creator": "deepseek",
        "include": [
          "deepseek-v4-flash-vision-exp",
          "deepseek-v4-pro",
          "deepseek-v4-flash"
        ],
        "idOverrides": {
          "deepseek-v4-flash-vision-exp": "deepseek/deepseek-v4-flash-vision-exp"
        }
      },
      {
        "creator": "kimi",
        "include": [
          "kimi-k3",
          "kimi-k2.7-code",
          "kimi-k2.6",
          "kimi-k2.5"
        ]
      },
      {
        "creator": "minimax",
        "include": [
          "MiniMax-M3",
          "MiniMax-M2.7",
          "MiniMax-M2.5"
        ],
        "idOverrides": {
          "MiniMax-M3": "minimax-m3"
        }
      },
      {
        "creator": "zai",
        "include": [
          "glm-5.3",
          "glm-5.3-flash",
          "glm-5.2",
          "glm-5.1",
          "glm-5v-turbo"
        ]
      }
    ]
  },
  "thinkingmachines": {
    "id": "thinkingmachines",
    "name": "Tinker",
    "apiDocsUrl": "https://tinker-docs.thinkingmachines.ai/tinker/",
    "pricing": {}
  },
  "together": {
    "id": "together",
    "name": "Together AI",
    "apiUrl": "https://api.together.xyz/v1",
    "apiDocsUrl": "https://docs.together.ai/docs/inference/chat/overview",
    "pricing": {},
    "models": [
      {
        "creator": "thinkingmachines",
        "include": [
          "thinkingmachines/Inkling"
        ],
        "idOverrides": {
          "thinkingmachines/Inkling": "thinkingmachines/inkling"
        }
      }
    ]
  },
  "xai": {
    "id": "xai",
    "name": "X.AI",
    "apiUrl": "https://x.ai/api",
    "apiDocsUrl": "https://x.ai/docs",
    "pricing": {}
  },
  "xiaomi": {
    "id": "xiaomi",
    "name": "Xiaomi MiMo",
    "apiUrl": "https://api.xiaomimimo.com/v1",
    "apiDocsUrl": "https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call",
    "pricing": {}
  },
  "zai": {
    "id": "zai",
    "name": "Z.ai",
    "apiUrl": "https://api.z.ai/api/paas/v4",
    "apiDocsUrl": "https://docs.z.ai/guides/overview/overview",
    "pricing": {}
  }
};
var organizations = {
  "openai": {
    "name": "OpenAI",
    "websiteUrl": "https://openai.com",
    "country": "USA",
    "founded": 2015
  },
  "anthropic": {
    "name": "Anthropic",
    "websiteUrl": "https://anthropic.com",
    "country": "USA",
    "founded": 2021
  },
  "meta": {
    "name": "Meta",
    "websiteUrl": "https://ai.meta.com",
    "country": "USA",
    "founded": 2004
  },
  "mistral": {
    "name": "Mistral AI",
    "websiteUrl": "https://mistral.ai",
    "country": "FRA",
    "founded": 2023
  },
  "cohere": {
    "name": "Cohere",
    "websiteUrl": "https://cohere.com",
    "country": "CAN",
    "founded": 2019
  },
  "deepseek": {
    "name": "DeepSeek",
    "websiteUrl": "https://deepseek.com",
    "country": "CHN",
    "founded": 2023
  },
  "google": {
    "name": "Google",
    "websiteUrl": "https://ai.google.dev",
    "country": "USA",
    "founded": 1998
  },
  "xai": {
    "name": "X.AI",
    "websiteUrl": "https://x.ai",
    "country": "USA",
    "founded": 2023
  },
  "groq": {
    "name": "Groq",
    "websiteUrl": "https://groq.com",
    "country": "USA",
    "founded": 2016
  },
  "qwen": {
    "name": "Qwen",
    "websiteUrl": "https://qwenlm.ai",
    "country": "CHN",
    "founded": 2023
  },
  "kimi": {
    "name": "Moonshot AI",
    "websiteUrl": "https://www.moonshot.ai",
    "country": "CHN",
    "founded": 2023
  },
  "minimax": {
    "name": "MiniMax",
    "websiteUrl": "https://www.minimax.io",
    "country": "CHN",
    "founded": 2022
  },
  "baidu": {
    "name": "Baidu",
    "websiteUrl": "https://www.baidu.com",
    "country": "CHN",
    "founded": 2e3
  },
  "nvidia": {
    "name": "NVIDIA",
    "websiteUrl": "https://www.nvidia.com",
    "country": "USA",
    "founded": 1993
  },
  "stepfun": {
    "name": "StepFun",
    "websiteUrl": "https://www.stepfun.com",
    "country": "CHN",
    "founded": 2023
  },
  "tencent": {
    "name": "Tencent",
    "websiteUrl": "https://www.tencent.com",
    "country": "CHN",
    "founded": 1998
  },
  "xiaomi": {
    "name": "Xiaomi",
    "websiteUrl": "https://www.mi.com",
    "country": "CHN",
    "founded": 2010
  },
  "zai": {
    "name": "Z.ai",
    "websiteUrl": "https://z.ai",
    "country": "CHN",
    "founded": 2019
  },
  "azure": {
    "name": "Azure",
    "websiteUrl": "https://azure.microsoft.com/en-us/products/ai-services/openai-service",
    "country": "USA",
    "founded": 1975
  },
  "aws": {
    "name": "Amazon Web Services",
    "websiteUrl": "https://aws.amazon.com",
    "country": "USA",
    "founded": 2006
  },
  "bedrock": {
    "name": "AWS Bedrock",
    "websiteUrl": "https://aws.amazon.com/bedrock",
    "country": "USA",
    "founded": 2023
  },
  "oracle": {
    "name": "Oracle Cloud",
    "websiteUrl": "https://www.oracle.com/cloud/ai-services",
    "country": "USA",
    "founded": 1977
  },
  "openrouter": {
    "name": "OpenRouter",
    "websiteUrl": "https://openrouter.ai",
    "country": "USA",
    "founded": 2023
  },
  "thinkingmachines": {
    "name": "Thinking Machines Lab",
    "websiteUrl": "https://thinkingmachines.ai",
    "country": "USA",
    "founded": 2025
  },
  "together": {
    "name": "Together AI",
    "websiteUrl": "https://www.together.ai",
    "country": "USA",
    "founded": 2022
  }
};

// src/types/modelCollection.ts
var ModelCollection = class _ModelCollection extends Array {
  // Static data stores - accessible from Model
  static providersData = {};
  static orgsData = {};
  static modelSources = {};
  /** Create a new ModelCollection from an array of models */
  constructor(models3 = []) {
    super();
    if (models3.length > 0) {
      this.push(...models3);
    }
    Object.setPrototypeOf(this, _ModelCollection.prototype);
  }
  /** Set the shared providers data */
  static setProviders(providers2) {
    _ModelCollection.providersData = providers2;
  }
  /** Set the shared creators data */
  static setOrgs(orgs) {
    _ModelCollection.orgsData = orgs;
  }
  /** Filter models by one or more capabilities (all must be present) */
  can(...capabilities) {
    return this.filter((model) => capabilities.every((cap) => model.capabilities.includes(cap)));
  }
  /** 
   * Fluent capability filters for better readability 
   * Each method filters models by a specific capability
   */
  // Basic capabilities
  canChat() {
    return this.can("chat");
  }
  canReason() {
    return this.can("reason");
  }
  // Text capabilities
  canRead() {
    return this.can("txt-in");
  }
  canWrite() {
    return this.can("txt-out");
  }
  // Image capabilities
  canSee() {
    return this.can("img-in");
  }
  canGenerateImages() {
    return this.can("img-out");
  }
  // Audio capabilities
  canHear() {
    return this.can("audio-in");
  }
  canSpeak() {
    return this.can("audio-out");
  }
  // Output capabilities
  canOutputJSON() {
    return this.can("json-out");
  }
  canCallFunctions() {
    return this.can("fn-out");
  }
  canGenerateEmbeddings() {
    return this.can("vec-out");
  }
  /** Filter models by one or more languages (all must be supported) */
  know(...languages) {
    return this.filter((model) => languages.every((lang) => model.languages?.includes(lang)));
  }
  /** Override array filter to return ModelCollection */
  filter(predicate) {
    const filtered = Array.from(this).filter(predicate);
    return new _ModelCollection(filtered);
  }
  /** Override array slice to return ModelCollection */
  slice(start, end) {
    const sliced = Array.from(this).slice(start, end);
    return new _ModelCollection(sliced);
  }
  /** Find a model by its ID or alias */
  id(modelId) {
    return this.find(
      (model) => model.id === modelId || model.aliases?.includes(modelId)
    );
  }
  /** Resolve a canonical model ID or alias to the ID required by a provider. */
  resolveModelIdForProvider(modelId, providerId) {
    return this.id(modelId)?.idFor(providerId);
  }
  /** Find a canonical model from an ID returned by a provider. */
  fromProviderId(providerId, providerModelId) {
    return this.fromProvider(providerId).find((model) => model.idFor(providerId) === providerModelId);
  }
  /** Get models available from a specific provider */
  fromProvider(provider) {
    return this.filter((model) => model.providerIds.includes(provider));
  }
  /** Get models available from a specific creator */
  fromCreator(creator) {
    return new _ModelCollection(
      this.filter((model) => model.creatorId === creator)
    );
  }
  /** Filter models by minimum context window size */
  withMinContext(tokens) {
    return this.filter((model) => {
      const context = model.context;
      if (context?.type !== "token" && context?.type !== "character") {
        return false;
      }
      if (context.total === null) {
        return false;
      }
      return context.total >= tokens;
    });
  }
  /** Get all providers from all models in the collection deduplicated */
  get providers() {
    const providerIds = [...new Set(this.flatMap((model) => model.providerIds))];
    const providers2 = [];
    for (const id of providerIds) {
      const provider = _ModelCollection.providersData[id];
      const organization = _ModelCollection.orgsData[id];
      providers2.push({
        ...organization,
        ...provider,
        id,
        pricing: provider.pricing ?? {}
      });
    }
    return providers2;
  }
  /** Get all orgs from all models in the collection deduplicated */
  get orgs() {
    const creatorIds = [...new Set(this.map((model) => model.creatorId).filter((id) => id !== void 0))];
    return creatorIds.map((id) => _ModelCollection.orgsData[id] ? { ..._ModelCollection.orgsData[id], id } : void 0).filter((c) => c !== void 0);
  }
  /** Organizations that create models in this collection. */
  get creators() {
    return this.orgs;
  }
  /** Providers that expose models in this collection. */
  get activeProviders() {
    return this.providers;
  }
  /** Get a specific provider by ID */
  getProvider(id) {
    const provider = _ModelCollection.providersData[id];
    if (!provider) return void 0;
    const organization = _ModelCollection.orgsData[id];
    return {
      ...organization,
      ...provider,
      id,
      pricing: provider.pricing ?? {}
    };
  }
  /** Get a specific creator by ID */
  getCreator(id) {
    const organization = _ModelCollection.orgsData[id];
    return organization ? { ...organization, id } : void 0;
  }
  /** Get providers for a specific model */
  getProvidersForModel(modelId) {
    const model = this.id(modelId);
    if (!model || !model.providerIds) return [];
    return model.providerIds.map((id) => this.getProvider(id)).filter((p) => p !== void 0);
  }
  /** Get creator for a specific model */
  getCreatorForModel(modelId) {
    const model = this.id(modelId);
    if (!model || !model.creatorId) return void 0;
    return this.getCreator(model.creatorId);
  }
};

// src/types/model.ts
var Model = class _Model {
  // Reference to the source data
  source;
  constructor(source) {
    this.source = source;
  }
  // Basic property getters (direct from source)
  get id() {
    return this.source.id;
  }
  get extends() {
    return this.source.extends;
  }
  get overrides() {
    return this.source.overrides;
  }
  // Helper method to resolve a property through the inheritance chain
  resolveProperty(propertyName) {
    if (this.source[propertyName] !== void 0) {
      return this.source[propertyName];
    }
    if (this.source.overrides && propertyName in this.source.overrides) {
      return this.source.overrides[propertyName];
    }
    if (this.source.extends) {
      const baseSource = ModelCollection.modelSources[this.source.extends];
      if (baseSource) {
        const baseModel = new _Model(baseSource);
        return baseModel.resolveProperty(propertyName);
      }
    }
    return void 0;
  }
  // Enhanced property getters (with inheritance resolution)
  get name() {
    return this.resolveProperty("name") || this.id;
  }
  // The array of capabilities - accessed through capabilities property
  get capabilities() {
    return this.resolveProperty("capabilities") || [];
  }
  get context() {
    return this.resolveProperty("context");
  }
  get license() {
    return this.resolveProperty("license");
  }
  get languages() {
    return this.resolveProperty("languages");
  }
  get aliases() {
    return this.source.aliases ?? this.source.overrides?.aliases;
  }
  get releasedAt() {
    return this.source.releasedAt ?? this.source.overrides?.releasedAt;
  }
  isIncludedBy(entry) {
    if (entry.creator !== this.creatorId) return false;
    if (entry.include === "all") return !entry.exclude?.includes(this.id);
    return entry.include.includes(this.id);
  }
  providerMapping(providerId) {
    return ModelCollection.providersData[providerId]?.models?.find((entry) => this.isIncludedBy(entry));
  }
  // Getters for related objects
  get providerIds() {
    const ids = /* @__PURE__ */ new Set();
    const creatorId = this.creatorId;
    if (!creatorId) return [];
    for (const [providerId, provider] of Object.entries(ModelCollection.providersData)) {
      const isNative = providerId === creatorId;
      const entries = provider.models;
      if (isNative) {
        if (!entries || entries.length === 0) {
          ids.add(providerId);
          continue;
        }
        const creatorEntry = entries.find((e) => e.creator === creatorId);
        if (!creatorEntry) {
          ids.add(providerId);
        } else if (this.isIncludedBy(creatorEntry)) {
          ids.add(providerId);
        }
        continue;
      }
      if (!entries) continue;
      if (entries.some((entry) => this.isIncludedBy(entry))) {
        ids.add(providerId);
      }
    }
    return Array.from(ids);
  }
  /**
   * Resolve this catalog model's canonical ID to the ID required by a provider.
   * Returns undefined when the provider does not expose this model.
   */
  idFor(providerId) {
    if (!this.providerIds.includes(providerId)) return void 0;
    const entry = this.providerMapping(providerId);
    const override = entry?.idOverrides?.[this.id];
    return override ?? `${entry?.idPrefix ?? ""}${this.id}`;
  }
  get providers() {
    const providers2 = [];
    for (const id of this.providerIds) {
      const provider = ModelCollection.providersData[id];
      const organization = ModelCollection.orgsData[id];
      providers2.push({
        ...organization,
        ...provider,
        id,
        pricing: provider.pricing ?? {}
      });
    }
    return providers2;
  }
  get creatorId() {
    return this.resolveProperty("creatorId");
  }
  get creator() {
    const id = this.creatorId;
    const organization = id ? ModelCollection.orgsData[id] : void 0;
    return organization && id ? { ...organization, id } : void 0;
  }
  /**
   * Check if model has all specified capabilities
   * Uses same API pattern as ModelCollection.can() but returns boolean
   */
  can(...capabilities) {
    return capabilities.every((cap) => this.capabilities.includes(cap));
  }
  // Basic capabilities
  canChat() {
    return this.capabilities.includes("chat");
  }
  canReason() {
    return this.capabilities.includes("reason");
  }
  // Text capabilities
  canRead() {
    return this.capabilities.includes("txt-in");
  }
  canWrite() {
    return this.capabilities.includes("txt-out");
  }
  // Image capabilities
  canSee() {
    return this.capabilities.includes("img-in");
  }
  canGenerateImages() {
    return this.capabilities.includes("img-out");
  }
  // Audio capabilities
  canHear() {
    return this.capabilities.includes("audio-in");
  }
  canSpeak() {
    return this.capabilities.includes("audio-out");
  }
  // Output capabilities
  canOutputJSON() {
    return this.capabilities.includes("json-out");
  }
  canCallFunctions() {
    return this.capabilities.includes("fn-out");
  }
  canGenerateEmbeddings() {
    return this.capabilities.includes("vec-out");
  }
};

// src/aimodels.ts
var AIModels = class _AIModels extends ModelCollection {
  // Singleton instance
  static _instance;
  /**
   * @private
   * Private constructor used only by the static instance getter.
   * Users should import the pre-configured instance from the package.
   */
  constructor(models3) {
    super(models3);
    Object.setPrototypeOf(this, _AIModels.prototype);
  }
  /**
  * Add data to the static data containers
  * @param data Object containing model sources, providers, and organizations to add
  */
  static addStaticData({
    models: models3 = {},
    providers: providers2 = {},
    orgs = {}
  }) {
    ModelCollection.modelSources = {
      ...ModelCollection.modelSources,
      ...models3
    };
    _AIModels.instance.length = 0;
    _AIModels.instance.push(...Object.values(ModelCollection.modelSources).map((source) => new Model(source)));
    ModelCollection.providersData = {
      ...ModelCollection.providersData,
      ...providers2
    };
    ModelCollection.orgsData = {
      ...ModelCollection.orgsData,
      ...orgs
    };
  }
  static get instance() {
    if (!_AIModels._instance) {
      _AIModels._instance = new _AIModels([]);
    }
    return _AIModels._instance;
  }
  /** 
   * Override to return all providers directly without filtering through models.
   * We want to return all known providers here.
   */
  get providers() {
    return Object.values(ModelCollection.providersData).map((provider) => ({
      ...ModelCollection.orgsData[provider.id],
      ...provider,
      id: provider.id,
      pricing: provider.pricing ?? {}
    }));
  }
  /** Providers that currently expose at least one catalog model. */
  get activeProviders() {
    return super.providers;
  }
  /**
   * Override to return all creators directly without filtering through models.
   * We want to return all known creators here.
   */
  get orgs() {
    return Object.entries(ModelCollection.orgsData).map(([id, organization]) => ({
      ...organization,
      id
    }));
  }
  /** All known organizations, including providers that are not model creators. */
  get organizations() {
    return this.orgs;
  }
  /** Organizations that create at least one model in this catalog. */
  get creators() {
    const creatorIds = [...new Set(this.map((model) => model.creatorId).filter(Boolean))];
    return creatorIds.map((id) => ModelCollection.orgsData[id] ? { ...ModelCollection.orgsData[id], id } : void 0).filter((organization) => organization !== void 0);
  }
};
var models2 = AIModels.instance;

// src/index.ts
AIModels.addStaticData({
  models,
  providers,
  orgs: organizations
});
export {
  AIModels,
  Model,
  ModelCollection,
  models2 as models
};
