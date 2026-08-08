CREATE TABLE `learning_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`page_id` text NOT NULL,
	`prompt_type` text NOT NULL,
	`response` text NOT NULL,
	`next_review_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `wiki_pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_learning_attempts_owner_due` ON `learning_attempts` (`owner_id`,`next_review_at`);--> statement-breakpoint
CREATE INDEX `idx_learning_attempts_owner_page` ON `learning_attempts` (`owner_id`,`page_id`);--> statement-breakpoint
CREATE TABLE `wiki_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`page_id` text,
	`action` text NOT NULL,
	`message` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `wiki_pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_wiki_activity_owner_created` ON `wiki_activity` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `wiki_links` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`from_page_id` text NOT NULL,
	`to_page_id` text NOT NULL,
	`relation` text NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`from_page_id`) REFERENCES `wiki_pages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_page_id`) REFERENCES `wiki_pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_wiki_links_owner_from` ON `wiki_links` (`owner_id`,`from_page_id`);--> statement-breakpoint
CREATE INDEX `idx_wiki_links_owner_to` ON `wiki_links` (`owner_id`,`to_page_id`);--> statement-breakpoint
CREATE TABLE `wiki_page_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`page_id` text NOT NULL,
	`raw_source_id` text NOT NULL,
	`contribution` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `wiki_pages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_source_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_wiki_page_sources_owner_page` ON `wiki_page_sources` (`owner_id`,`page_id`);--> statement-breakpoint
CREATE INDEX `idx_wiki_page_sources_owner_raw` ON `wiki_page_sources` (`owner_id`,`raw_source_id`);--> statement-breakpoint
CREATE TABLE `wiki_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`evidence_status` text DEFAULT 'verified' NOT NULL,
	`recall_prompt` text DEFAULT '' NOT NULL,
	`transfer_prompt` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_wiki_pages_owner_kind` ON `wiki_pages` (`owner_id`,`kind`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_wiki_pages_owner_title` ON `wiki_pages` (`owner_id`,`title`);--> statement-breakpoint
ALTER TABLE `knowledge_cards` ADD `wiki_page_id` text REFERENCES wiki_pages(id);