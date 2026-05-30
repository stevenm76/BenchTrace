CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`trace_id` text NOT NULL,
	`type` text NOT NULL,
	`filename` text NOT NULL,
	`path` text,
	`sha256` text,
	`parser` text,
	`parser_status` text,
	`parser_confidence` real,
	`raw_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`trace_id`) REFERENCES `traces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artifacts_trace_id_idx` ON `artifacts` (`trace_id`);--> statement-breakpoint
CREATE TABLE `benchmark_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text,
	`profile_version` text,
	`name` text NOT NULL,
	`purpose` text,
	`tool` text,
	`tool_version` text,
	`command` text,
	`dataset` text,
	`prompt_source` text,
	`workload_type` text,
	`input_length` integer,
	`output_length` integer,
	`num_prompts` integer,
	`concurrency` integer,
	`request_rate` real,
	`concurrency_strategy` text,
	`warmup_runs` integer,
	`measurement_duration_seconds` real,
	`random_seed` integer,
	`streaming_enabled` integer,
	`endpoint` text,
	`ttft_sla_ms` real,
	`tpot_sla_ms` real,
	`required_metrics` text,
	`optional_metrics` text,
	`compatible_engines` text,
	`comparability_notes` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cost_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`trace_id` text NOT NULL,
	`estimated_system_cost` real,
	`estimated_gpu_cost` real,
	`currency` text,
	`cost_basis_notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`trace_id`) REFERENCES `traces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `engines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text,
	`type` text NOT NULL,
	`openai_compatible` integer,
	`container_image` text,
	`git_sha` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `engines_type_idx` ON `engines` (`type`);--> statement-breakpoint
CREATE INDEX `engines_version_idx` ON `engines` (`version`);--> statement-breakpoint
CREATE TABLE `hardware_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cpu` text,
	`ram_gb` real,
	`motherboard` text,
	`chipset` text,
	`storage` text,
	`os` text,
	`kernel` text,
	`gpu_count` integer,
	`gpu_models` text,
	`gpu_vram_gb` real,
	`gpu_pcie_generation` text,
	`gpu_pcie_width` text,
	`driver_version` text,
	`cuda_version` text,
	`rocm_version` text,
	`container_runtime` text,
	`container_image` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `loader_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`engine_id` text NOT NULL,
	`launch_command` text,
	`environment_variables` text,
	`tensor_parallel_size` integer,
	`pipeline_parallel_size` integer,
	`data_parallel_size` integer,
	`kv_cache_dtype` text,
	`max_model_len` integer,
	`gpu_memory_utilization` real,
	`flash_attention` integer,
	`speculative_decoding` integer,
	`draft_model` text,
	`mtp_enabled` integer,
	`chunked_prefill` integer,
	`prefix_caching` integer,
	`cpu_offload` integer,
	`gpu_residency` text,
	`batch_size_settings` text,
	`scheduler_settings` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`engine_id`) REFERENCES `engines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `metric_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`metric_point_id` text NOT NULL,
	`normalized_metric_name` text NOT NULL,
	`raw_metric_name` text,
	`metric_source` text,
	`source_tool_version` text,
	`definition` text,
	`aggregation_method` text,
	`percentile` real,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`metric_point_id`) REFERENCES `metric_points`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `metric_points` (
	`id` text PRIMARY KEY NOT NULL,
	`trace_id` text NOT NULL,
	`concurrency` integer,
	`request_rate` real,
	`successful_requests` integer,
	`failed_requests` integer,
	`failure_rate` real,
	`output_tokens_per_second` real,
	`total_tokens_per_second` real,
	`prefill_tokens_per_second` real,
	`requests_per_second` real,
	`p50_ttft_ms` real,
	`p95_ttft_ms` real,
	`p99_ttft_ms` real,
	`p50_tpot_ms` real,
	`p95_tpot_ms` real,
	`p99_tpot_ms` real,
	`p50_itl_ms` real,
	`p95_itl_ms` real,
	`p99_itl_ms` real,
	`p50_e2e_latency_ms` real,
	`p95_e2e_latency_ms` real,
	`p99_e2e_latency_ms` real,
	`peak_vram_gb` real,
	`average_vram_gb` real,
	`peak_ram_gb` real,
	`average_ram_gb` real,
	`gpu_utilization_avg` real,
	`gpu_utilization_peak` real,
	`cpu_utilization_avg` real,
	`cpu_utilization_peak` real,
	`power_draw_watts_avg` real,
	`power_draw_watts_peak` real,
	`gpu_temperature_avg` real,
	`gpu_temperature_peak` real,
	`tokens_per_watt` real,
	`tokens_per_dollar` real,
	`cost_per_1m_generated_tokens` real,
	`cost_per_1m_total_tokens` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`trace_id`) REFERENCES `traces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `metric_points_trace_id_idx` ON `metric_points` (`trace_id`);--> statement-breakpoint
CREATE INDEX `metric_points_output_tps_idx` ON `metric_points` (`output_tokens_per_second`);--> statement-breakpoint
CREATE INDEX `metric_points_p95_ttft_idx` ON `metric_points` (`p95_ttft_ms`);--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text,
	`name` text NOT NULL,
	`repo_or_path` text,
	`architecture` text,
	`dense_or_moe` text,
	`parameter_count` real,
	`active_parameter_count` real,
	`quantization` text,
	`precision` text,
	`format` text,
	`tokenizer` text,
	`claimed_context_length` integer,
	`modality` text,
	`capabilities` text,
	`license` text,
	`model_hash` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `models_name_idx` ON `models` (`name`);--> statement-breakpoint
CREATE INDEX `models_quantization_idx` ON `models` (`quantization`);--> statement-breakpoint
CREATE INDEX `models_architecture_idx` ON `models` (`architecture`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `traces` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`status` text DEFAULT 'imported' NOT NULL,
	`model_id` text NOT NULL,
	`engine_id` text NOT NULL,
	`hardware_profile_id` text NOT NULL,
	`loader_config_id` text,
	`benchmark_profile_id` text,
	`native_benchmark_tool` text,
	`context_length` integer,
	`tags` text,
	`notes` text,
	`verification_level` text DEFAULT 'weak' NOT NULL,
	`fingerprint` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`engine_id`) REFERENCES `engines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`hardware_profile_id`) REFERENCES `hardware_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`loader_config_id`) REFERENCES `loader_configs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`benchmark_profile_id`) REFERENCES `benchmark_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `traces_model_id_idx` ON `traces` (`model_id`);--> statement-breakpoint
CREATE INDEX `traces_engine_id_idx` ON `traces` (`engine_id`);--> statement-breakpoint
CREATE INDEX `traces_verification_idx` ON `traces` (`verification_level`);--> statement-breakpoint
CREATE INDEX `traces_created_at_idx` ON `traces` (`created_at`);--> statement-breakpoint
CREATE INDEX `traces_fingerprint_idx` ON `traces` (`fingerprint`);