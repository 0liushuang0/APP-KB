import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

/**
 * HTTP 指标埋点：按路由聚合请求数/错误数/延迟直方图。
 * /api/metrics 自身不记，避免抓取把指标打爆。
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const start = Date.now();
    return next.handle().pipe(
      tap({
        next: () => this.record(context, req, start),
        error: (err) => this.record(context, req, start, err?.status ?? 500),
      }),
    );
  }

  private record(context: ExecutionContext, req: any, start: number, status?: number): void {
    try {
      const res = context.switchToHttp().getResponse();
      const routePath = req.route?.path || req.originalUrl?.split('?')[0] || req.url || 'unknown';
      const route = `${req.method} ${String(routePath).replace(/\//g, '/')}`;
      if (route.includes('/api/metrics')) return;
      this.metrics.record(route, status ?? res?.statusCode ?? 200, Date.now() - start);
    } catch {
      // 指标埋点绝不能影响业务请求
    }
  }
}
