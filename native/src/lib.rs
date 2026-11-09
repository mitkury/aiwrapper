#![doc = include_str!("../README.md")]
//! AIWrapper's native runtime. Hosts own credentials, tools, storage and transport.
mod agent;
mod catalog;
mod compression;
mod error;
pub mod live;
mod messages;
mod mock;
mod provider;
pub mod speech;
mod stream;
mod tools;
mod transport;
mod usage;

pub use agent::*;
/// The embedded [AIModels](https://github.com/mitkury/aimodels) catalog crate.
#[cfg(feature = "catalog")]
pub use aimodels;
#[cfg(feature = "catalog")]
pub use catalog::models;
pub use compression::*;
pub use error::*;
pub use messages::*;
pub use mock::*;
pub use provider::*;
pub use tokio_util::sync::CancellationToken;
pub use tools::*;
pub use transport::*;
pub use usage::*;
