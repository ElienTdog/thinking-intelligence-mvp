ALTER TABLE `wiki_pages` ADD `local_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_wiki_pages_owner_local_path` ON `wiki_pages` (`owner_id`,`local_path`);
