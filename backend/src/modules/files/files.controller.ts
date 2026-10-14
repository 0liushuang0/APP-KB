import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Res,
  NotFoundException,
  ForbiddenException,
  StreamableFile,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
// archiver 的 @types 8.x 与 import 形式不兼容，项目内统一用 require（与 backup.service 同一模式）
// eslint-disable-next-line @typescript-eslint/no-var-requires
const archiver = require('archiver');
import { IsArray, IsString, ArrayMaxSize, ArrayMinSize } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document } from '../documents/entities/document.entity';
import {
  RequirementAttachment,
  Requirement,
} from '../requirements/entities/requirement.entity';
import { ProductAttachment, Product } from '../products/entities/product.entity';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CurrentUser as CurrentUserType,
  PermissionService,
} from '../../common/services/permission.service';
import {
  safeReadPath,
  resolveDocumentFilePath,
} from '../../common/utils/safe-path.util';
import {
  convertOfficeToPdf,
  OfficePreviewUnavailableError,
} from '../../common/utils/office-preview.util';

type FileKind = 'documents' | 'requirements' | 'products';

/** 可被 LibreOffice 转 PDF 预览的 Office 扩展名 */
const OFFICE_EXTENSIONS = new Set([
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf',
]);

interface ResolvedFile {
  filePath: string;
  fileName: string;
  mimeType?: string;
}

/** 批量打包下载的请求体（ValidationPipe whitelist 下必须有显式装饰器） */
class BatchDownloadDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  documentIds: string[];
}

/**
 * 受控文件下载与预览。
 *
 * 取代原先的 `app.use('/uploads', express.static(...))` —— 那种做法把整个上传目录
 * 无鉴权地暴露出去：知道 URL 就能拿到任何技术协议、报价单、客户图纸，
 * 实体上精心设计的 visibility / groupIds / roleCodes 全部形同虚设。
 *
 * 这里每次访问都要：① 登录态 ② 查到归属记录 ③ 过一遍权限判定 ④ 路径越界校验。
 */
@ApiTags('文件下载')
@Controller('files')
export class FilesController {
  private readonly dirs: Record<FileKind, string>;
  private readonly uploadsBase: string;

  constructor(
    @InjectRepository(Document) private documents: Repository<Document>,
    @InjectRepository(RequirementAttachment)
    private requirementAttachments: Repository<RequirementAttachment>,
    @InjectRepository(Requirement)
    private requirements: Repository<Requirement>,
    @InjectRepository(ProductAttachment)
    private productAttachments: Repository<ProductAttachment>,
    @InjectRepository(Product)
    private products: Repository<Product>,
    private permission: PermissionService,
    private config: ConfigService,
  ) {
    this.uploadsBase = path.resolve(process.cwd(), 'data', 'uploads');
    this.dirs = {
      documents: path.join(this.uploadsBase, 'documents'),
      requirements: path.join(this.uploadsBase, 'requirements'),
      products: path.join(this.uploadsBase, 'products'),
    };
  }

  /**
   * 按 kind 查实体 + 行级权限校验 + 算出源文件绝对路径。
   * 三个下载端点和预览端点共用，避免权限逻辑散落多处。
   */
  private async resolveAccessibleFile(
    kind: FileKind,
    id: string,
    user: CurrentUserType,
  ): Promise<ResolvedFile> {
    if (kind === 'documents') {
      const doc = await this.documents.findOne({ where: { id } });
      if (!doc) throw new NotFoundException('文件不存在');
      if (
        !this.permission.canAccess(user, {
          visibility: doc.visibility,
          uploaderId: doc.uploaderId,
          departmentId: doc.departmentId,
          groupIds: doc.groupIds,
          roleCodes: doc.roleCodes,
        })
      ) {
        throw new ForbiddenException('无权访问该文件');
      }
      return {
        // documents 表同时存业务资料 / 知识资料 / 历史版本，前缀不同目录也不同
        filePath: resolveDocumentFilePath(this.uploadsBase, doc.fileKey),
        fileName: doc.fileName,
        mimeType: doc.mimeType,
      };
    }

    if (kind === 'requirements') {
      const att = await this.requirementAttachments.findOne({ where: { id } });
      if (!att) throw new NotFoundException('附件不存在');
      const requirement = await this.requirements.findOne({
        where: { id: att.requirementId },
      });
      if (requirement) {
        if (
          !this.permission.canAccess(user, {
            visibility: requirement.visibility,
            uploaderId: requirement.ownerId,
            departmentId: requirement.departmentId,
            groupIds: requirement.groupIds,
            roleCodes: requirement.roleCodes,
          })
        ) {
          throw new ForbiddenException('无权访问该需求附件');
        }
      }
      return {
        filePath: safeReadPath(this.dirs.requirements, att.fileKey, 'requirements/'),
        fileName: att.fileName,
        mimeType: att.mimeType,
      };
    }

    // products
    const att = await this.productAttachments.findOne({ where: { id } });
    if (!att) throw new NotFoundException('附件不存在');
    const product = await this.products.findOne({ where: { id: att.productId } });
    if (product) {
      if (
        !this.permission.canAccess(user, {
          visibility: product.visibility,
          uploaderId: product.ownerId,
          departmentId: product.departmentId,
          groupIds: product.groupIds,
          roleCodes: product.roleCodes,
        })
      ) {
        throw new ForbiddenException('无权访问该产品附件');
      }
    }
    return {
      filePath: safeReadPath(this.dirs.products, att.fileKey, 'products/'),
      fileName: att.fileName,
      mimeType: att.mimeType,
    };
  }

  /** 文档中心的文件 */
  @Get('documents/:id')
  async documentFile(
    @Param('id') id: string,
    @Query('download') download: string,
    @CurrentUser() user: CurrentUserType,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.resolveAccessibleFile('documents', id, user);
    return this.stream(f.filePath, f.fileName, f.mimeType, download === '1', res);
  }

  /**
   * 批量打包下载：多个资料压成一个 zip 一次拿走。
   *
   * 权限与路径校验和单个下载完全一致（复用 resolveAccessibleFile）——
   * 无权访问的文件直接 403，不做"跳过继续"：静默缺文件比明确报错更坑人
   * （用户以为拿全了，实际少了报价单）。同名文件在包内自动加序号。
   * 直接写 response（不经 TransformInterceptor 包 JSON），zip 流式生成不落盘。
   */
  @Post('batch-download')
  async batchDownload(
    @Body() dto: BatchDownloadDto,
    @CurrentUser() user: CurrentUserType,
    @Res() res: Response,
  ): Promise<void> {
    const files: ResolvedFile[] = [];
    for (const id of dto.documentIds) {
      files.push(await this.resolveAccessibleFile('documents', id, user));
    }

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', () => { /* 单文件异常不中断整包 */ });
    archive.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });

    const used = new Map<string, number>();
    for (const f of files) {
      let name = f.fileName || 'unnamed';
      if (used.has(name)) {
        const n = used.get(name)! + 1;
        used.set(name, n);
        const ext = path.extname(name);
        name = `${name.slice(0, name.length - ext.length)}(${n})${ext}`;
      } else {
        used.set(name, 1);
      }
      archive.append(fs.createReadStream(f.filePath), { name });
    }
    archive.finalize();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(`资料打包-${new Date().toISOString().slice(0, 10)}.zip`)}"`,
    );
    archive.pipe(res);
  }

  /** 需求附件 */
  @Get('requirements/:id')
  async requirementAttachment(
    @Param('id') id: string,
    @Query('download') download: string,
    @CurrentUser() user: CurrentUserType,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.resolveAccessibleFile('requirements', id, user);
    return this.stream(f.filePath, f.fileName, f.mimeType, download === '1', res);
  }

  /** 产品附件 */
  @Get('products/:id')
  async productAttachment(
    @Param('id') id: string,
    @Query('download') download: string,
    @CurrentUser() user: CurrentUserType,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.resolveAccessibleFile('products', id, user);
    return this.stream(f.filePath, f.fileName, f.mimeType, download === '1', res);
  }

  /**
   * Office 文档转 PDF 预览。
   *
   * 对 doc/docx/xls/xlsx/ppt/pptx 等，用 LibreOffice headless 转成 PDF，
   * 前端在 <iframe> 里高保真预览。权限校验与下载端点完全一致（复用 resolveAccessibleFile），
   * 转换结果按源文件 mtime 缓存，重复预览不重转。
   */
  @Get(':kind/:id/preview-pdf')
  async previewPdf(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (kind !== 'documents' && kind !== 'requirements' && kind !== 'products') {
      throw new BadRequestException('未知的文件类型');
    }
    const f = await this.resolveAccessibleFile(kind as FileKind, id, user);

    const ext = path.extname(f.filePath).toLowerCase();
    if (!OFFICE_EXTENSIONS.has(ext)) {
      throw new BadRequestException('该文件类型无需转换，请直接预览或下载');
    }
    if (!fs.existsSync(f.filePath)) {
      throw new NotFoundException('文件已丢失，可能已被删除');
    }

    let pdfPath: string;
    try {
      const result = await convertOfficeToPdf(f.filePath, this.uploadsBase);
      pdfPath = result.pdfPath;
    } catch (err) {
      if (err instanceof OfficePreviewUnavailableError) {
        // LibreOffice 未安装：让前端能明确提示用户
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }

    return this.stream(pdfPath, `${path.basename(f.fileName, ext)}.pdf`, 'application/pdf', false, res);
  }

  /**
   * 流式返回，避免把大文件整个读进内存。
   * inline 用于浏览器内预览，attachment 用于下载。
   */
  private stream(
    filePath: string,
    fileName: string,
    mimeType: string | undefined,
    forceDownload: boolean,
    res: Response,
  ): StreamableFile {
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('文件已丢失，可能已被删除');
    }

    const disposition = forceDownload ? 'attachment' : 'inline';
    // filename* 用 RFC 5987 编码，中文文件名才不会乱码
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    // 带上长度：浏览器才能显示下载进度，传输被截断时也能立刻发现
    res.setHeader('Content-Length', String(fs.statSync(filePath).size));
    // 上传件不应被中间层缓存
    res.setHeader('Cache-Control', 'private, no-store');
    // 防止浏览器把上传内容当 HTML 执行（存储型 XSS）
    res.setHeader('X-Content-Type-Options', 'nosniff');

    /*
     * 覆盖 helmet 的全局 CSP。
     *
     * 全局策略里有 frame-ancestors 'none'，它是给页面防点击劫持用的，但会连带
     * 禁止**这个文件本身**被放进 iframe —— PDF 预览正是 <iframe src=文件地址>，
     * 于是 Chrome 在框里画出「localhost 拒绝了我们的连接请求」。
     * 文件内容看起来像"连不上服务器"，其实是被浏览器拦下了。
     *
     * 这里换成只允许被本站页面内嵌：既放行预览，又不给别的站点内嵌客户图纸的机会。
     * 其余方向仍然收得比全局更紧（default-src 'none'：上传的 HTML 里即使有脚本也跑不起来）。
     */
    const appOrigin = this.config.get<string>('app.corsOrigin');
    const frameAncestors = ["'self'", appOrigin].filter(Boolean).join(' ');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "img-src 'self' data: blob:",
        "style-src 'unsafe-inline'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        `frame-ancestors ${frameAncestors}`,
      ].join('; '),
    );
    /*
     * X-Frame-Options 只认 SAMEORIGIN/DENY，表达不了"允许前端那个源"。
     * 前后端分开部署（前端 5174、后端 3001）时它会盖掉上面的放行，
     * 而 frame-ancestors 已经把范围限死了，所以这里去掉它。
     */
    res.removeHeader('X-Frame-Options');

    return new StreamableFile(fs.createReadStream(filePath));
  }
}
