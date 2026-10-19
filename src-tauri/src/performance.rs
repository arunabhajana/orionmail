//! Local timing for expensive synchronous work; never records mail content.
pub(crate) struct WorkSpan {
    name: &'static str,
    started: std::time::Instant,
}
impl WorkSpan {
    pub fn new(name: &'static str) -> Self {
        Self { name, started: std::time::Instant::now() }
    }
}
impl Drop for WorkSpan {
    fn drop(&mut self) {
        let elapsed = self.started.elapsed();
        if elapsed >= std::time::Duration::from_millis(250) {
            log::info!("[performance] {} took {} ms", self.name, elapsed.as_millis());
        }
    }
}
