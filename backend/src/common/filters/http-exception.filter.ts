import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

/** 字段名 → 用户看得懂的叫法。缺省就用字段名本身，不至于说不清 */
const FIELD_LABELS: Record<string, string> = {
  code: '编号',
  productNo: '产品编号',
  proposalNo: '方案编号',
  quotationNo: '报价编号',
  requirementNo: '需求编号',
  projectNo: '项目编号',
  category: '分类',
  name: '名称',
  username: '用户名',
  email: '邮箱',
};

/**
 * 把数据库唯一约束冲突翻译成人能看懂的话。
 *
 * 触发场景很日常：新建产品时「编号」留空 —— products.code 上有 UNIQUE，
 * 而库里已经存在一条空编号的产品，第二条空值就撞了约束。
 * 用户看到的是「Internal server error」，既不知道是哪个字段，
 * 也不知道自己其实什么都没做错。
 *
 * 这类约束遍布各张表，所以在全局过滤器里统一处理，
 * 而不是等哪个接口被投诉了再去补哪个。
 */
function describeConstraintError(exception: unknown): string | null {
  const raw =
    exception instanceof Error ? `${exception.message} ${(exception as any).detail ?? ''}` : '';
  if (!raw) return null;

  const isUnique =
    /UNIQUE constraint failed/i.test(raw) ||
    /duplicate key value violates unique constraint/i.test(raw) ||
    (exception as any)?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    (exception as any)?.code === '23505';

  if (isUnique) {
    // SQLite: "UNIQUE constraint failed: products.code"
    // Postgres: "Key (code)=(T-A) already exists."
    const column =
      /UNIQUE constraint failed:\s*[\w"]+\.(\w+)/i.exec(raw)?.[1] ||
      /Key \((\w+)\)=/i.exec(raw)?.[1];
    const label = column ? FIELD_LABELS[column] || column : null;
    return label
      ? `${label}已存在，请换一个（留空也会与已有的空值冲突）`
      : '该记录与已有数据重复，请检查唯一字段';
  }

  if (/NOT NULL constraint failed:\s*[\w"]+\.(\w+)/i.test(raw)) {
    const column = /NOT NULL constraint failed:\s*[\w"]+\.(\w+)/i.exec(raw)?.[1];
    const label = column ? FIELD_LABELS[column] || column : '必填项';
    return `${label}不能为空`;
  }

  if (/FOREIGN KEY constraint failed/i.test(raw) || (exception as any)?.code === '23503') {
    return '关联的数据不存在或已被删除，请刷新后重试';
  }

  return null;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    // 数据库约束冲突是"用户填重了"，不是"系统崩了"
    const constraint = describeConstraintError(exception);

    const status = constraint
      ? HttpStatus.CONFLICT
      : exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: any =
      constraint ??
      (exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error');

    if (typeof message === 'object' && message !== null) {
      message = message.message || message.error || JSON.stringify(message);
      if (Array.isArray(message)) message = message.join('; ');
    }

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} ${status} - ${exception instanceof Error ? exception.message : 'Unknown error'}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    });
  }
}
