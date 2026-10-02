import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  success: boolean;
  statusCode: number;
  data: T;
}

/**
 * 二进制响应不能被包成 { success, data }。
 *
 * Nest 只有在控制器**直接**返回 StreamableFile 时才会去 pipe 它；一旦被塞进
 * `{ success, statusCode, data }` 里，它就是个普通对象，Express 会 res.json()
 * 把 ReadStream 的内部字段序列化成两三百字节的 JSON 发给浏览器 ——
 * 下载下来的"文件"根本不是文件，打不开、大小也对不上（下载/预览全线失效）。
 *
 * Buffer 同理（会变成 { type: 'Buffer', data: [...] } 的数字数组）。
 */
function isBinaryPayload(data: unknown): boolean {
  if (data instanceof StreamableFile) return true;
  if (Buffer.isBuffer(data)) return true;
  // 直接返回的可读流（未包装成 StreamableFile）
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { pipe?: unknown }).pipe === 'function'
  );
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, Response<T> | T>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<Response<T> | T> {
    const statusCode = context.switchToHttp().getResponse().statusCode;
    return next.handle().pipe(
      map((data) =>
        isBinaryPayload(data)
          ? data
          : {
              success: true,
              statusCode,
              data,
            },
      ),
    );
  }
}
