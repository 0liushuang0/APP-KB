import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditLogQuery {
  userId?: string;
  action?: string;
  objectType?: string;
  startDate?: string;
  endDate?: string;
}

export interface AuditUser {
  userId?: string;
}

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
  ) {}

  async findAll(query: AuditLogQuery): Promise<AuditLog[]> {
    const qb = this.auditLogRepository.createQueryBuilder('log');

    if (query.userId) {
      qb.andWhere('log.userId = :userId', { userId: query.userId });
    }
    if (query.action) {
      qb.andWhere('log.action = :action', { action: query.action });
    }
    if (query.objectType) {
      qb.andWhere('log.objectType = :objectType', {
        objectType: query.objectType,
      });
    }
    if (query.startDate) {
      qb.andWhere('log.createdAt >= :startDate', {
        startDate: new Date(query.startDate),
      });
    }
    if (query.endDate) {
      qb.andWhere('log.createdAt <= :endDate', {
        endDate: new Date(query.endDate),
      });
    }

    qb.orderBy('log.createdAt', 'DESC');
    return qb.getMany();
  }

  async create(data: Partial<AuditLog>): Promise<AuditLog> {
    const log = this.auditLogRepository.create(data);
    return this.auditLogRepository.save(log);
  }

  async log(
    user: AuditUser | null | undefined,
    action: string,
    objectType: string,
    objectId?: string,
    detail?: string,
    ip?: string,
  ): Promise<AuditLog> {
    try {
      return await this.create({
        userId: user?.userId,
        action,
        objectType,
        objectId,
        detail,
        ip,
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log: ${err?.message}`,
        err?.stack,
      );
    }
  }
}
