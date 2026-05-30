ALTER TABLE `metric_points` ADD `p50_chunk_gap_ms` real;--> statement-breakpoint
ALTER TABLE `metric_points` ADD `p95_chunk_gap_ms` real;--> statement-breakpoint
ALTER TABLE `metric_points` ADD `p99_chunk_gap_ms` real;--> statement-breakpoint
ALTER TABLE `metric_points` ADD `mean_chunks_per_request` real;--> statement-breakpoint
ALTER TABLE `metric_points` ADD `mean_tokens_per_chunk` real;--> statement-breakpoint
ALTER TABLE `metric_points` ADD `output_token_count_source` text;--> statement-breakpoint
ALTER TABLE `traces` ADD `metric_mode` text;