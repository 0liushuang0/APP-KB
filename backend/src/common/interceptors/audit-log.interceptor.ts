import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { domainEvents } from '../services/domain-events';

const ACTION_MAP: Record<string, string> = {
  POST: 'create',
  PATCH: 'update',
  PUT: 'update',
  DELETE: 'delete',
};

const IGNORED_PATHS = ['/api/auth', '/api/system/seed', '/api/system/info', '/api/ai-call-logs', '/api/audit-logs'];

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private readonly auditLogsService: AuditLogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const path: string = request.path || request.url || '';

    if (IGNORED_PATHS.some((p) => path.includes(p))) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: (result) => {
          domainEvents.emitEvent('data.changed', { objectType: path.replace(/^\/api\//, '').split('/')[0] || '' });
          this.writeLog(request, result).catch((err) =>
            this.logger.warn(`Audit log write failed: ${err?.message}`),
          );
        },
      }),
    );
  }

  private async writeLog(request: any, result: any): Promise<void> {
    const path: string = request.path || request.url || '';
    const method = request.method;
    const action = ACTION_MAP[method] || method.toLowerCase();

    const pathParts = path.replace(/^\/api\//, '').split('/').filter(Boolean);
    const objectType = pathParts[0] || 'unknown';

    const objectId =
      result?.id || pathParts.find((p, i) => i > 0 && /^[0-9a-f-]{8,}$/i.test(p)) || pathParts[1];

    const user = request.user;
    const ip = request.ip || request.headers['x-forwarded-for'] || request.connection?.remoteAddress;

    let detail: string | undefined;
    if (action === 'create' || action === 'update') {
      const bodyKeys = Object.keys(request.body || {}).filter((k) => !['password', 'token', 'secret'].includes(k));
      detail = bodyKeys.length > 0 ? `fields: ${bodyKeys.join(', ')}` : undefined;
    } else if (action === 'delete') {
      detail = `path: ${path}`;
    }

    await this.auditLogsService.log(
      user,
      action,
      objectType,
      objectId,
      detail,
      ip,
    );
  }
}
