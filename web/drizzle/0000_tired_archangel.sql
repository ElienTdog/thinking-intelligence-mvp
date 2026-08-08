CREATE TABLE `judgment_deltas` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`question_id` text NOT NULL,
	`material_id` text NOT NULL,
	`response_type` text NOT NULL,
	`response_text` text NOT NULL,
	`validation_scenario` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_deltas_owner_question_created` ON `judgment_deltas` (`owner_id`,`question_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`question_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`challenge` text NOT NULL,
	`relevance` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_materials_owner_question` ON `materials` (`owner_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`initial_judgment` text NOT NULL,
	`priority` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_questions_owner_priority` ON `questions` (`owner_id`,`priority`);