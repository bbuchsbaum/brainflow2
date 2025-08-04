// Performance benchmarking utilities for render loop

use std::collections::VecDeque;
use std::time::Instant;

/// Simple frame time tracker for performance monitoring
#[derive(Debug, Clone)]
pub struct FrameTimeTracker {
    /// Rolling window of frame times in milliseconds
    frame_times: VecDeque<f32>,
    /// Maximum number of samples to keep
    max_samples: usize,
    /// Total frames recorded
    total_frames: u64,
    /// Start time of tracking
    start_time: Instant,
}

impl FrameTimeTracker {
    /// Create a new frame time tracker
    pub fn new(max_samples: usize) -> Self {
        Self {
            frame_times: VecDeque::with_capacity(max_samples),
            max_samples,
            total_frames: 0,
            start_time: Instant::now(),
        }
    }

    /// Record a new frame time
    pub fn record_frame(&mut self, time_ms: f32) {
        if self.frame_times.len() >= self.max_samples {
            self.frame_times.pop_front();
        }
        self.frame_times.push_back(time_ms);
        self.total_frames += 1;
    }

    /// Record frame time from a duration
    pub fn record_duration(&mut self, duration: std::time::Duration) {
        self.record_frame(duration.as_secs_f32() * 1000.0);
    }

    /// Get average frame time in milliseconds
    pub fn average_ms(&self) -> f32 {
        if self.frame_times.is_empty() {
            0.0
        } else {
            self.frame_times.iter().sum::<f32>() / self.frame_times.len() as f32
        }
    }

    /// Get frames per second
    pub fn fps(&self) -> f32 {
        let avg_ms = self.average_ms();
        if avg_ms > 0.0 {
            1000.0 / avg_ms
        } else {
            0.0
        }
    }

    /// Get minimum frame time
    pub fn min_ms(&self) -> f32 {
        self.frame_times
            .iter()
            .cloned()
            .fold(f32::INFINITY, f32::min)
    }

    /// Get maximum frame time
    pub fn max_ms(&self) -> f32 {
        self.frame_times.iter().cloned().fold(0.0, f32::max)
    }

    /// Get percentile frame time (e.g., 95th percentile)
    pub fn percentile_ms(&self, percentile: f32) -> f32 {
        if self.frame_times.is_empty() {
            return 0.0;
        }

        let mut sorted: Vec<f32> = self.frame_times.iter().cloned().collect();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let index = ((percentile / 100.0) * (sorted.len() - 1) as f32) as usize;
        sorted[index.min(sorted.len() - 1)]
    }

    /// Get total frames recorded
    pub fn total_frames(&self) -> u64 {
        self.total_frames
    }

    /// Get elapsed time since tracking started
    pub fn elapsed(&self) -> std::time::Duration {
        self.start_time.elapsed()
    }

    /// Reset the tracker
    pub fn reset(&mut self) {
        self.frame_times.clear();
        self.total_frames = 0;
        self.start_time = Instant::now();
    }

    /// Get a summary string
    pub fn summary(&self) -> String {
        format!(
            "FPS: {:.1} | Avg: {:.2}ms | Min: {:.2}ms | Max: {:.2}ms | 95%: {:.2}ms | Frames: {}",
            self.fps(),
            self.average_ms(),
            self.min_ms(),
            self.max_ms(),
            self.percentile_ms(95.0),
            self.total_frames
        )
    }
}

/// Render pass profiler for detailed timing
#[derive(Debug)]
pub struct RenderPassProfiler {
    /// Name of the current pass
    pass_name: String,
    /// Start time of the pass
    start_time: Option<Instant>,
    /// Accumulated timings for different stages
    stage_times: Vec<(String, f32)>,
}

impl RenderPassProfiler {
    /// Create a new profiler for a render pass
    pub fn new(pass_name: impl Into<String>) -> Self {
        Self {
            pass_name: pass_name.into(),
            start_time: None,
            stage_times: Vec::new(),
        }
    }

    /// Start timing a stage
    pub fn start_stage(&mut self) {
        self.start_time = Some(Instant::now());
    }

    /// End timing a stage and record it
    pub fn end_stage(&mut self, stage_name: impl Into<String>) {
        if let Some(start) = self.start_time.take() {
            let elapsed_ms = start.elapsed().as_secs_f32() * 1000.0;
            self.stage_times.push((stage_name.into(), elapsed_ms));
        }
    }

    /// Get total time for all stages
    pub fn total_ms(&self) -> f32 {
        self.stage_times.iter().map(|(_, time)| time).sum()
    }

    /// Print a detailed breakdown
    pub fn print_breakdown(&self) {
        println!("\n=== {} Profile ===", self.pass_name);
        println!("Total: {:.2}ms", self.total_ms());
        for (stage, time) in &self.stage_times {
            let percentage = (time / self.total_ms()) * 100.0;
            println!("  {}: {:.2}ms ({:.1}%)", stage, time, percentage);
        }
    }

    /// Get breakdown as string
    pub fn breakdown_string(&self) -> String {
        let mut result = format!("{} - Total: {:.2}ms\n", self.pass_name, self.total_ms());
        for (stage, time) in &self.stage_times {
            let percentage = (time / self.total_ms()) * 100.0;
            result.push_str(&format!(
                "  {}: {:.2}ms ({:.1}%)\n",
                stage, time, percentage
            ));
        }
        result
    }
}

/// GPU timing helper using timestamp queries
#[derive(Debug)]
pub struct GpuTimer {
    /// Query set for timestamps
    query_set: wgpu::QuerySet,
    /// Buffer to resolve queries into
    resolve_buffer: wgpu::Buffer,
    /// Buffer to read back results
    readback_buffer: wgpu::Buffer,
    /// Number of timestamp pairs
    capacity: u32,
}

impl GpuTimer {
    /// Create a new GPU timer
    pub fn new(device: &wgpu::Device, capacity: u32) -> Self {
        let query_set = device.create_query_set(&wgpu::QuerySetDescriptor {
            label: Some("GPU Timer Query Set"),
            ty: wgpu::QueryType::Timestamp,
            count: capacity * 2, // Start and end for each measurement
        });

        let resolve_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("GPU Timer Resolve Buffer"),
            size: 8 * capacity as u64 * 2, // 8 bytes per timestamp
            usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        let readback_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("GPU Timer Readback Buffer"),
            size: 8 * capacity as u64 * 2,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        Self {
            query_set,
            resolve_buffer,
            readback_buffer,
            capacity,
        }
    }

    /// Write timestamp at the beginning of a pass
    pub fn write_timestamp_start(&self, encoder: &mut wgpu::CommandEncoder, index: u32) {
        if index < self.capacity {
            encoder.write_timestamp(&self.query_set, index * 2);
        }
    }

    /// Write timestamp at the end of a pass
    pub fn write_timestamp_end(&self, encoder: &mut wgpu::CommandEncoder, index: u32) {
        if index < self.capacity {
            encoder.write_timestamp(&self.query_set, index * 2 + 1);
        }
    }

    /// Resolve timestamps and prepare for readback
    pub fn resolve(&self, encoder: &mut wgpu::CommandEncoder, count: u32) {
        let count = count.min(self.capacity);
        encoder.resolve_query_set(&self.query_set, 0..count * 2, &self.resolve_buffer, 0);
        encoder.copy_buffer_to_buffer(
            &self.resolve_buffer,
            0,
            &self.readback_buffer,
            0,
            8 * count as u64 * 2,
        );
    }

    /// Read back timing results (blocking)
    pub async fn read_results(&self, device: &wgpu::Device, count: u32) -> Vec<f32> {
        let count = count.min(self.capacity);

        let buffer_slice = self.readback_buffer.slice(0..8 * count as u64 * 2);
        let (sender, receiver) = flume::bounded(1);
        buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
            sender.send(result).unwrap();
        });

        device.poll(wgpu::Maintain::Wait);
        receiver.recv_async().await.unwrap().unwrap();

        let data = buffer_slice.get_mapped_range();
        let timestamps: Vec<u64> = bytemuck::cast_slice(&data).to_vec();
        drop(data);
        self.readback_buffer.unmap();

        // Convert timestamp pairs to durations in milliseconds
        let mut results = Vec::new();
        for i in 0..count as usize {
            let start = timestamps[i * 2];
            let end = timestamps[i * 2 + 1];
            if end > start {
                // Convert nanoseconds to milliseconds
                results.push((end - start) as f32 / 1_000_000.0);
            } else {
                results.push(0.0);
            }
        }

        results
    }
}

/// Performance comparison result
#[derive(Debug)]
pub struct PerformanceComparison {
    pub baseline_name: String,
    pub baseline_fps: f32,
    pub baseline_ms: f32,
    pub optimized_name: String,
    pub optimized_fps: f32,
    pub optimized_ms: f32,
    pub improvement_percent: f32,
    pub speedup_factor: f32,
}

impl PerformanceComparison {
    /// Create a comparison from two frame trackers
    pub fn from_trackers(
        baseline_name: impl Into<String>,
        baseline: &FrameTimeTracker,
        optimized_name: impl Into<String>,
        optimized: &FrameTimeTracker,
    ) -> Self {
        let baseline_ms = baseline.average_ms();
        let optimized_ms = optimized.average_ms();
        let improvement_percent = if baseline_ms > 0.0 {
            ((baseline_ms - optimized_ms) / baseline_ms) * 100.0
        } else {
            0.0
        };
        let speedup_factor = if optimized_ms > 0.0 {
            baseline_ms / optimized_ms
        } else {
            1.0
        };

        Self {
            baseline_name: baseline_name.into(),
            baseline_fps: baseline.fps(),
            baseline_ms,
            optimized_name: optimized_name.into(),
            optimized_fps: optimized.fps(),
            optimized_ms,
            improvement_percent,
            speedup_factor,
        }
    }

    /// Print a formatted comparison
    pub fn print_summary(&self) {
        println!("\n=== Performance Comparison ===");
        println!(
            "{}: {:.2}ms ({:.1} FPS)",
            self.baseline_name, self.baseline_ms, self.baseline_fps
        );
        println!(
            "{}: {:.2}ms ({:.1} FPS)",
            self.optimized_name, self.optimized_ms, self.optimized_fps
        );
        println!(
            "Improvement: {:.1}% ({:.2}x speedup)",
            self.improvement_percent, self.speedup_factor
        );

        if self.improvement_percent > 0.0 {
            println!("✓ Optimization successful!");
        } else if self.improvement_percent < -5.0 {
            println!("⚠ Performance regression detected!");
        } else {
            println!("≈ Performance similar");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_frame_tracker() {
        let mut tracker = FrameTimeTracker::new(5);

        // Record some frame times
        tracker.record_frame(16.0);
        tracker.record_frame(17.0);
        tracker.record_frame(16.5);
        tracker.record_frame(18.0);
        tracker.record_frame(16.0);

        assert_eq!(tracker.average_ms(), 16.7);
        assert!((tracker.fps() - 59.88).abs() < 0.1);
        assert_eq!(tracker.min_ms(), 16.0);
        assert_eq!(tracker.max_ms(), 18.0);

        // Add more frames to test rolling window
        tracker.record_frame(20.0);
        assert_eq!(tracker.frame_times.len(), 5);
        assert_eq!(tracker.total_frames(), 6);
    }

    #[test]
    fn test_render_profiler() {
        let mut profiler = RenderPassProfiler::new("Test Pass");

        profiler.start_stage();
        std::thread::sleep(std::time::Duration::from_millis(10));
        profiler.end_stage("Stage 1");

        profiler.start_stage();
        std::thread::sleep(std::time::Duration::from_millis(5));
        profiler.end_stage("Stage 2");

        assert!(profiler.total_ms() >= 15.0);
        assert_eq!(profiler.stage_times.len(), 2);
    }

    #[test]
    fn test_performance_comparison() {
        let mut baseline = FrameTimeTracker::new(100);
        let mut optimized = FrameTimeTracker::new(100);

        // Simulate baseline performance
        for _ in 0..50 {
            baseline.record_frame(20.0); // 50 FPS
        }

        // Simulate optimized performance
        for _ in 0..50 {
            optimized.record_frame(16.0); // 62.5 FPS
        }

        let comparison =
            PerformanceComparison::from_trackers("Baseline", &baseline, "Optimized", &optimized);

        assert_eq!(comparison.baseline_ms, 20.0);
        assert_eq!(comparison.optimized_ms, 16.0);
        assert_eq!(comparison.improvement_percent, 20.0);
        assert_eq!(comparison.speedup_factor, 1.25);
    }
}
