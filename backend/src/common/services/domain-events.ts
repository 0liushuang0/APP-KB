import { EventEmitter } from 'events';

/**
 * 进程内的业务事件（单进程部署，够用且不引入依赖）。
 *
 * 用来把"资料解析完成""资料挂到某张单据上"这类事实通知给关心它的模块，
 * 而不让模块之间互相注入、形成循环依赖。例如：需求下挂的技术附件解析完 →
 * 需求模块自动做一次结构化识别。
 *
 * 监听方必须自己吞掉异常 —— 事件是锦上添花，不能反过来拖垮发出事件的主流程。
 */
export interface DomainEvents {
  'document.parsed': { documentId: string };
  'document.linked': { documentId: string; requirementId?: string | null };
  /** 任一业务写操作成功（增删改）：统计缓存据此失效，工作台不再显示十几秒前的旧数 */
  'data.changed': { objectType: string };
}

class TypedEmitter extends EventEmitter {
  emitEvent<K extends keyof DomainEvents>(name: K, payload: DomainEvents[K]): void {
    try {
      this.emit(name, payload);
    } catch {
      /* 监听方异常不影响发出方 */
    }
  }

  onEvent<K extends keyof DomainEvents>(name: K, fn: (payload: DomainEvents[K]) => void): () => void {
    const wrapped = (p: DomainEvents[K]) => {
      try {
        const r: any = fn(p);
        if (r && typeof r.catch === 'function') r.catch(() => undefined);
      } catch {
        /* 吞掉 */
      }
    };
    this.on(name, wrapped);
    return () => this.off(name, wrapped);
  }
}

export const domainEvents = new TypedEmitter();
domainEvents.setMaxListeners(50);
