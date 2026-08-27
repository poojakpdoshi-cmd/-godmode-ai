CREATE TABLE `conversationAttachments` (
	`id` varchar(36) NOT NULL,
	`conversationId` varchar(36) NOT NULL,
	`messageId` varchar(36),
	`userId` int NOT NULL,
	`kind` enum('upload','generated_code') NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`mimeType` varchar(120) NOT NULL,
	`sizeBytes` int NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversationAttachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `conversationAttachments` ADD CONSTRAINT `conversationAttachments_conversationId_conversations_id_fk` FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversationAttachments` ADD CONSTRAINT `conversationAttachments_messageId_conversationMessages_id_fk` FOREIGN KEY (`messageId`) REFERENCES `conversationMessages`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversationAttachments` ADD CONSTRAINT `conversationAttachments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `conversation_attachments_message_idx` ON `conversationAttachments` (`messageId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `conversation_attachments_user_conversation_idx` ON `conversationAttachments` (`userId`,`conversationId`,`createdAt`);