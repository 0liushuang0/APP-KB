# 物料主档（方案A）P1+P2+P3 · 文件级落地方案

> 三项决策已落实：①物料编码自动生成（扩展 NumberingService + 设置页可配）；②品类复用 `system_configs` 的 `supplier_categories`（`useSupplierCategories` hook），供应商大类改→物料自动跟随；③实施 P1→P2→P3。

## 共用：规格签名工具
`backend/src/common/utils/spec-signature.util.ts`（新建）：`computeSpecSignature([{name,value}])` —— 归一化（trim、lowercase、全角→半角、`Φ→φ`、`MM→mm`、去单位空格）后按 name 排序 `join('|')` 再 hash。物料建卡与供应产品自动匹配都用它。

---

## P1：物料实体 + 编码自动生成 + 物料管理页

### 后端
1. **迁移 `1787600000000-AddMaterials.ts`**（新建）：建 `materials` 表 —— `id(uuid PK)`, `materialCode(varchar 唯一)`, `name(varchar)`, `category(varchar)`, `specs(text/json)`, `specSignature(varchar)`, `unit(默认'件')`, `standardPrice(decimal(14,2) nullable)`, `description(text)`, `createdAt/updatedAt`；索引 `category`、`materialCode`。
2. **`modules/materials/entities/material.entity.ts`**（新建）：Material 实体（字段同上，`specs` 为 `ProductSpecItem[]` 复用 products 的 `{name,value}` 结构）。
3. **`modules/materials/materials.service.ts`**（新建）：CRUD；`create()` 时 `materialCode = await numbering.next('material')` + `specSignature = computeSpecSignature(specs)`；`findByCategory`、`matchBySignature(sig)`（供 P2 自动匹配）。
4. **`modules/materials/materials.controller.ts`**（新建）：`GET /materials`(列表,带 category/keyword 过滤)、`POST`、`PATCH/:id`、`DELETE/:id`、`GET /materials/:id/offerings`（P3 该物料的供应报价，占位）。
5. **`modules/materials/materials.module.ts`**（新建）+ 在 `app.module.ts` 注册。
6. **`common/services/numbering.service.ts`** 扩展 4 处：`NumberedEntity` 加 `'material'`；`DEFAULT_RULES` 加 `material: { prefix:'MAT', yearFormat:'YYYY', digits:4, separator:'-' }`；`SOURCE` 加 `material: { table:'materials', column:'materialCode' }`。
7. **`modules/numbering/numbering.controller.ts`** `ENTITIES` 白名单加 `'material'`。

### 前端
8. **`api/services.ts`** 加 `materialApi`（list/get/create/update/remove）。
9. **`types/index.ts`** 加 `Material` 类型。
10. **`pages/Materials.tsx`**（新建）：左=品类树（`useSupplierCategories` 取大类，与供应商同源）；右=物料列表（编码/名称/规格摘要/基准价/已关联供应商数）+ 新建/编辑弹窗（名称、品类下拉=供应商大类、规格编辑器复用产品那套、单位、基准价；**编码自动生成只读展示**，保存时后端 `next('material')` 生成）；删除带"有关联供应报价则提示"。
11. **`pages/settings/NumberingRules.tsx`** `Entity`/`ENTITY_LABELS`/`ORDER` 加 `material`（标签"物料"）→ 设置页可改物料编码规则。
12. **`router/index.tsx`** + 导航：加 `/materials` 路由与菜单项（"物料管理"，放供应比价附近）。

---

## P2：供应产品挂物料 + 自动匹配

### 后端
13. **迁移 `1787610000000-AddSupplierProductMaterial.ts`**（新建）：`supplier_products` 加 `materialId(varchar nullable)`、`specs(text/json nullable)`；索引 `materialId`。
14. **`suppliers/entities/supplier.entity.ts`** SupplierProduct 加 `materialId`、`specs` 列。
15. **`suppliers/dto/supplier.dto.ts`** Create/UpdateSupplierProductDto 加 `materialId?`、`specs?`。
16. **`suppliers/supplier-products.service.ts`**：`normalize()`/create/update 透传 `specs`，写入时算 `specSignature`（存内存不落列，用于匹配）；新增 `autoLinkMaterial(id)` —— 按 signature 调 `materials.service.matchBySignature`，命中唯一则回填 `materialId`；`compare()` 返回的 `CompareRow` 加 `materialId`、`specs`。

### 前端
17. **供应产品编辑**（`SupplierCompare.tsx` 或供应商目录编辑处）：加"关联物料"选择器（`materialApi.list` 搜索）+ "按规格自动匹配"按钮（调 autoLink）；列表/比价行显示已挂物料名。
18. **批量自动匹配**：供应商目录页加"一键自动匹配物料"（遍历未挂的供应产品，按 signature 匹配）。

---

## P3：按物料比价

### 后端
19. **`materials.service.ts`** 加 `offerings(materialId)`：返回该物料下所有 `supplier_products`（含各供应商报价/交期/档次/履约），按 priceMin 升序 —— 即"同规格跨厂家比价"的数据。
20. **`materials.controller.tsx`** 暴露 `GET /materials/:id/offerings`。
21. **`supplier-products.service.ts` compare()**：加 `materialId` 过滤参数（只比某物料的各家）。

### 前端
22. **`Materials.tsx` 详情/抽屉**：选中物料 → 右侧/抽屉展示"该物料各厂家报价对比表"（厂家/品牌/型号/单价区间/交期/MOQ/档次/履约评分），高亮最低价 —— 直接达成"同规格外购件跨厂家比价"。
23. **`SupplierCompare.tsx`** 顶部加"按物料比价"入口：选物料 → 过滤展示同一物料的各家行（保留现有"按品类列出"模式作过渡）。

---

## 验证（每期）
- 后端 `tsc` + materials/numbering 单测；迁移在 SQLite/PG 通用（纯 ADD COLUMN/CREATE TABLE）。
- 前端 `tsc`；物料页 CRUD、编码自增、品类与供应商联动；供应产品挂物料+自动匹配；物料详情比价表。

## 不在本期（P4 后续）
- `product_boms` 挂 materialId、从 BOM 发起询比价、`quotation_items` 反查物料（闭环）。

## 实施顺序
先 **P1**（实体+迁移+编码+物料页，可独立验收）→ **P2**（供应产品挂物料+自动匹配）→ **P3**（按物料比价视图）。每期完成即验证，再进下一期。