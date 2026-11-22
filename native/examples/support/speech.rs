//! Speech provider configuration shared by the development hosts.
use aiwrapper::{Error, Result, speech::Speech};
use serde::Deserialize;

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SpeechProvider {
    Openai,
    Elevenlabs,
    Deepgram,
}

impl SpeechProvider {
    pub fn client(self) -> Result<Speech> {
        let (prefix, default_url) = match self {
            Self::Deepgram => ("DEEPGRAM", "https://api.deepgram.com/v1"),
            Self::Openai => ("OPENAI", "https://api.openai.com/v1"),
            Self::Elevenlabs => ("ELEVENLABS", "https://api.elevenlabs.io/v1"),
        };
        let setting = |name| {
            std::env::var(format!("{prefix}_{name}"))
                .ok()
                .filter(|v| !v.trim().is_empty())
        };
        let key = setting("API_KEY")
            .ok_or_else(|| Error::Invalid(format!("{prefix}_API_KEY is not configured")))?;
        Speech::new(
            key,
            setting("BASE_URL").unwrap_or_else(|| default_url.into()),
        )
    }
}
