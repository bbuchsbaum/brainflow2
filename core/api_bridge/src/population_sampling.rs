//! Bounded cancellation admission for population queries. Cancellation can
//! arrive before the sampling command: retain its tombstone through the ticket
//! deadline, and refuse expired tickets instead of silently restarting work.
use bridge_types::{BridgeError, BridgeResult};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{sync::watch, time::Instant};

const MAX_TICKETS: usize = 8192;
const MAX_LIFETIME_MS: u64 = 120_000;

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleTicket {
    pub id: String,
    pub expires_at_ms: u64,
}

#[derive(Clone)]
pub struct SampleCancellation {
    signal: watch::Sender<bool>,
    deadline: Option<Instant>,
}
impl Default for SampleCancellation {
    fn default() -> Self {
        Self {
            signal: watch::channel(false).0,
            deadline: None,
        }
    }
}
impl SampleCancellation {
    pub fn check(&self) -> BridgeResult<()> {
        if *self.signal.borrow()
            || self
                .deadline
                .is_some_and(|deadline| Instant::now() >= deadline)
        {
            Err(cancelled())
        } else {
            Ok(())
        }
    }
    pub fn cancel(&self) {
        self.signal.send_replace(true);
    }
    pub async fn cancelled(&self) {
        let mut receiver = self.signal.subscribe();
        let deadline = async {
            match self.deadline {
                Some(deadline) => tokio::time::sleep_until(deadline).await,
                None => std::future::pending::<()>().await,
            }
        };
        tokio::select! {
            _ = receiver.wait_for(|value| *value) => {},
            _ = deadline => {},
        }
    }
}

struct Entry {
    expires_at_ms: u64,
    cancellation: SampleCancellation,
}
#[derive(Default)]
pub struct PopulationSampling {
    tickets: Mutex<HashMap<String, Entry>>,
}
impl PopulationSampling {
    pub fn begin(&self, ticket: &SampleTicket) -> BridgeResult<SampleCancellation> {
        self.admit(ticket, false, now_ms()?)
    }
    pub fn cancel(&self, ticket: &SampleTicket) -> BridgeResult<()> {
        // Expired tickets can never start again; their cancellation is a no-op.
        let now = now_ms()?;
        if ticket.expires_at_ms <= now {
            return Ok(());
        }
        self.admit(ticket, true, now).map(|_| ())
    }
    fn admit(
        &self,
        ticket: &SampleTicket,
        cancel: bool,
        now: u64,
    ) -> BridgeResult<SampleCancellation> {
        if uuid::Uuid::parse_str(&ticket.id).is_err() {
            return Err(input("Population sample ticket requires a UUID."));
        }
        let remaining = ticket
            .expires_at_ms
            .checked_sub(now)
            .filter(|remaining| *remaining > 0 && *remaining <= MAX_LIFETIME_MS)
            .ok_or_else(|| {
                input("Population sample ticket expired or exceeds its two-minute lifetime.")
            })?;
        let mut tickets = self
            .tickets
            .lock()
            .map_err(|_| input("Population sampling registry unavailable."))?;
        tickets.retain(|_, entry| entry.expires_at_ms > now);
        if let Some(entry) = tickets.get(&ticket.id) {
            if entry.expires_at_ms != ticket.expires_at_ms {
                return Err(input(
                    "Population sample ticket identity was reused with a different deadline.",
                ));
            }
            if cancel {
                entry.cancellation.cancel();
                return Ok(entry.cancellation.clone());
            }
            entry.cancellation.check()?;
            return Err(input("Population sample ticket has already been used."));
        }
        if tickets.len() >= MAX_TICKETS {
            return Err(input(
                "Too many population sample tickets; retry after active tickets expire.",
            ));
        }
        let cancellation = SampleCancellation {
            deadline: Some(Instant::now() + Duration::from_millis(remaining)),
            ..Default::default()
        };
        if cancel {
            cancellation.cancel();
        }
        tickets.insert(
            ticket.id.clone(),
            Entry {
                expires_at_ms: ticket.expires_at_ms,
                cancellation: cancellation.clone(),
            },
        );
        Ok(cancellation)
    }
}
fn now_ms() -> BridgeResult<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_millis() as u64)
        .map_err(|_| input("System clock precedes the population query epoch."))
}
pub fn cancelled() -> BridgeError {
    BridgeError::Input {
        code: 2026,
        details: "Population sampling canceled or expired.".into(),
    }
}
fn input(details: &str) -> BridgeError {
    BridgeError::Input {
        code: 2025,
        details: details.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ticket(expires_at_ms: u64) -> SampleTicket {
        SampleTicket {
            id: uuid::Uuid::new_v4().to_string(),
            expires_at_ms,
        }
    }
    #[tokio::test]
    async fn cancellation_before_start_and_replay_cannot_launch_work() {
        let registry = PopulationSampling::default();
        let ticket = ticket(2000);
        registry.admit(&ticket, true, 1000).unwrap();
        assert!(registry.admit(&ticket, false, 1000).is_err());
        assert!(registry.admit(&ticket, false, 2001).is_err());
        let ticket = self::ticket(3000);
        registry.admit(&ticket, false, 2000).unwrap();
        assert!(registry.admit(&ticket, false, 2000).is_err());
    }
    #[tokio::test(start_paused = true)]
    async fn cancellation_and_deadline_wake_waiters() {
        let registry = PopulationSampling::default();
        let ticket = ticket(2000);
        let token = registry.admit(&ticket, false, 1000).unwrap();
        registry.admit(&ticket, true, 1000).unwrap();
        token.cancelled().await;
        assert!(token.check().is_err());
        let token = registry.admit(&self::ticket(3000), false, 2000).unwrap();
        tokio::time::advance(Duration::from_millis(1001)).await;
        token.cancelled().await;
        assert!(token.check().is_err());
    }
    #[test]
    fn tickets_are_bounded_and_expired_tombstones_are_reclaimed() {
        let registry = PopulationSampling::default();
        for _ in 0..MAX_TICKETS {
            registry.admit(&ticket(2000), true, 1000).unwrap();
        }
        assert!(registry.admit(&ticket(2000), false, 1000).is_err());
        registry.admit(&ticket(3000), false, 2001).unwrap();
        assert_eq!(registry.tickets.lock().unwrap().len(), 1);
        assert!(registry.admit(&ticket(500_000), false, 2001).is_err());
    }
}
