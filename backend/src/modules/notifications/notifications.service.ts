import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,
  ) {}

  /** 创建通知（供其他模块调用） */
  async create(dto: {
    type: string;
    title: string;
    content?: string;
    recipientId: string;
    linkUrl?: string;
  }): Promise<Notification> {
    const n = this.notificationRepository.create(dto);
    return this.notificationRepository.save(n);
  }

  /** 列表（可只看未读） */
  async findAll(userId: string, unreadOnly = false): Promise<Notification[]> {
    return this.notificationRepository.find({
      where: unreadOnly ? { recipientId: userId, read: false } : { recipientId: userId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  /** 未读数 */
  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationRepository.count({
      where: { recipientId: userId, read: false },
    });
  }

  /** 标记单条已读 */
  async markAsRead(id: string): Promise<void> {
    await this.notificationRepository.update(id, { read: true });
  }

  /** 全部标记已读 */
  async markAllRead(userId: string): Promise<void> {
    await this.notificationRepository.update(
      { recipientId: userId, read: false },
      { read: true },
    );
  }
}
