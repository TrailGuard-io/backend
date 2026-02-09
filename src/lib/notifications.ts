import { EventEmitter } from "events";
import { Prisma, PrismaClient } from "@prisma/client";

export type NotificationPayload = {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string | null;
  data: Prisma.JsonValue | null;
  read: boolean;
  createdAt: Date;
};

export const notificationEvents = new EventEmitter();
notificationEvents.setMaxListeners(0);

export const emitNotification = (notification: NotificationPayload) => {
  notificationEvents.emit("notification", notification);
};

export const createNotification = async (
  prisma: PrismaClient,
  data: Prisma.NotificationCreateInput
) => {
  const notification = await prisma.notification.create({ data });
  emitNotification(notification);
  return notification;
};

export const createNotifications = async (
  prisma: PrismaClient,
  items: Prisma.NotificationCreateInput[]
) => {
  if (!items.length) return [];
  const notifications = await prisma.$transaction(
    items.map((item) => prisma.notification.create({ data: item }))
  );
  notifications.forEach((notification) => emitNotification(notification));
  return notifications;
};
