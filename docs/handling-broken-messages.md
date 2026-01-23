# Handling broken messages

[Agents](agent.md) or underlying [language providers](language-provider.md) can be interrupted, which may result in a set of messages with tool requests but without results. If we send a follow-up message to an AI, it will most likely return an error saying that it expects to see the results. To handle this, we have logic that detects the validity of a message chain and, if it's invalid, tries to fix it so the messages can be sent to an AI provider.
