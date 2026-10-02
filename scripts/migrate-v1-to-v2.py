import argparse
import os
import sqlite3
import uuid
import requests
from datetime import datetime
from sqlalchemy import create_engine, text
from typing import Dict, List


def clean_id(old_id: int) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f'aikb.v1.{old_id}'))


def connect_sqlite(path: str):
    return sqlite3.connect(path)


def connect_pg(url: str):
    return create_engine(url)


def _table_exists(sqlite_conn, table: str) -> bool:
    cursor = sqlite_conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
    return cursor.fetchone() is not None


def migrate_customers(sqlite_conn, pg_engine):
    if not _table_exists(sqlite_conn, 'customer'):
        print('Skipping customers (table not found)')
        return
    cursor = sqlite_conn.cursor()
    cursor.execute('SELECT * FROM customer')
    rows = cursor.fetchall()
    cols = [d[0] for d in cursor.description]
    customers = [dict(zip(cols, row)) for row in rows]

    with pg_engine.begin() as conn:
        for c in customers:
            new_id = clean_id(c['id'])
            conn.execute(text("""
                INSERT INTO customers (id, name, code, industry, description, status, visibility, createdAt, updatedAt)
                VALUES (:id, :name, :code, :industry, :description, :status, 'public', :createdAt, :updatedAt)
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
            """), {
                'id': new_id,
                'name': c.get('customer_name') or c.get('name'),
                'code': c.get('code') or f'CUST-{c["id"]}',
                'industry': c.get('industry'),
                'description': c.get('needs_description') or c.get('notes') or c.get('description'),
                'status': 'approved',
                'createdAt': c.get('created_at') or datetime.now(),
                'updatedAt': c.get('updated_at') or datetime.now(),
            })
    print(f'Migrated {len(customers)} customers')


def migrate_proposals(sqlite_conn, pg_engine):
    if not _table_exists(sqlite_conn, 'proposal'):
        print('Skipping proposals (table not found)')
        return
    cursor = sqlite_conn.cursor()
    cursor.execute('SELECT * FROM proposal')
    rows = cursor.fetchall()
    cols = [d[0] for d in cursor.description]
    proposals = [dict(zip(cols, row)) for row in rows]

    with pg_engine.begin() as conn:
        for p in proposals:
            new_id = clean_id(p['id'])
            customer_id = clean_id(p['customer_id']) if p.get('customer_id') else None
            conn.execute(text("""
                INSERT INTO proposals (id, proposalNo, customerId, title, productDescription, proposalType, version, status, content, requirements, aiGenerated, sourceProposalId, createdAt, updatedAt, visibility)
                VALUES (:id, :proposalNo, :customerId, :title, :productDescription, :proposalType, :version, :status, :content, :requirements, :aiGenerated, :sourceProposalId, :createdAt, :updatedAt, 'public')
                ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title
            """), {
                'id': new_id,
                'proposalNo': p.get('proposal_no') or f'P-{p["id"]}',
                'customerId': customer_id,
                'title': p.get('title') or p.get('proposal_no') or f'Proposal {p["id"]}',
                'productDescription': p.get('product_description'),
                'proposalType': p.get('proposal_type'),
                'version': int(p.get('version', 1)) if str(p.get('version', '1')).isdigit() else 1,
                'status': 'approved',
                'content': p.get('content'),
                'requirements': p.get('requirements'),
                'aiGenerated': bool(p.get('ai_generated', False)),
                'sourceProposalId': clean_id(p['source_proposal_id']) if p.get('source_proposal_id') else None,
                'createdAt': p.get('created_at') or datetime.now(),
                'updatedAt': p.get('updated_at') or datetime.now(),
            })
    print(f'Migrated {len(proposals)} proposals')


def migrate_quotations(sqlite_conn, pg_engine):
    if not _table_exists(sqlite_conn, 'quotation'):
        print('Skipping quotations (table not found)')
        return
    cursor = sqlite_conn.cursor()
    cursor.execute('SELECT * FROM quotation')
    rows = cursor.fetchall()
    cols = [d[0] for d in cursor.description]
    quotations = [dict(zip(cols, row)) for row in rows]

    with pg_engine.begin() as conn:
        for q in quotations:
            new_id = clean_id(q['id'])
            conn.execute(text("""
                INSERT INTO quotations (id, quotationNo, customerId, amount, status, costBreakdown, notes, createdAt, updatedAt, visibility)
                VALUES (:id, :quotationNo, :customerId, :amount, :status, :costBreakdown, :notes, :createdAt, :updatedAt, 'public')
                ON CONFLICT (id) DO UPDATE SET quotationNo = EXCLUDED.quotationNo
            """), {
                'id': new_id,
                'quotationNo': q.get('quotation_no') or f'Q-{q["id"]}',
                'customerId': None,
                'amount': q.get('total_price', 0),
                'status': 'approved',
                'costBreakdown': f"材料:{q.get('cost_material',0)} 人工:{q.get('cost_labor',0)} 外协:{q.get('cost_outsource',0)} 管理:{q.get('cost_overhead',0)}",
                'notes': q.get('notes'),
                'createdAt': q.get('created_at') or datetime.now(),
                'updatedAt': q.get('updated_at') or datetime.now(),
            })
    print(f'Migrated {len(quotations)} quotations')


def migrate_products(sqlite_conn, pg_engine):
    if not _table_exists(sqlite_conn, 'product'):
        print('Skipping products (table not found)')
        return
    cursor = sqlite_conn.cursor()
    cursor.execute('SELECT * FROM product')
    rows = cursor.fetchall()
    cols = [d[0] for d in cursor.description]
    products = [dict(zip(cols, row)) for row in rows]

    with pg_engine.begin() as conn:
        for p in products:
            new_id = clean_id(p['id'])
            conn.execute(text("""
                INSERT INTO products (id, name, code, category, description, price, unit, status, visibility, createdAt, updatedAt)
                VALUES (:id, :name, :code, :category, :description, :price, :unit, :status, 'public', :createdAt, :updatedAt)
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
            """), {
                'id': new_id,
                'name': p.get('product_name') or p.get('name'),
                'code': p.get('product_no') or p.get('code'),
                'category': p.get('product_family') or p.get('category'),
                'description': p.get('key_specs') or p.get('notes') or p.get('description'),
                'price': p.get('reference_price_max') or p.get('price'),
                'unit': '件',
                'status': 'approved',
                'createdAt': p.get('created_at') or datetime.now(),
                'updatedAt': p.get('updated_at') or datetime.now(),
            })
    print(f'Migrated {len(products)} products')


def migrate_suppliers(sqlite_conn, pg_engine):
    if not _table_exists(sqlite_conn, 'supplier'):
        print('Skipping suppliers (table not found)')
        return
    cursor = sqlite_conn.cursor()
    cursor.execute('SELECT * FROM supplier')
    rows = cursor.fetchall()
    cols = [d[0] for d in cursor.description]
    suppliers = [dict(zip(cols, row)) for row in rows]

    with pg_engine.begin() as conn:
        for s in suppliers:
            new_id = clean_id(s['id'])
            conn.execute(text("""
                INSERT INTO suppliers (id, name, code, contactName, phone, email, address, description, status, visibility, createdAt, updatedAt)
                VALUES (:id, :name, :code, :contactName, :phone, :email, :address, :description, :status, 'public', :createdAt, :updatedAt)
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
            """), {
                'id': new_id,
                'name': s.get('supplier_name') or s.get('name'),
                'code': s.get('supplier_no') or s.get('code'),
                'contactName': s.get('contact_person') or s.get('contact_name'),
                'phone': s.get('phone'),
                'email': s.get('email'),
                'address': s.get('address'),
                'description': s.get('notes') or s.get('description'),
                'status': 'approved',
                'createdAt': s.get('created_at') or datetime.now(),
                'updatedAt': s.get('updated_at') or datetime.now(),
            })
    print(f'Migrated {len(suppliers)} suppliers')


def migrate_projects(sqlite_conn, pg_engine):
    if not _table_exists(sqlite_conn, 'project'):
        print('Skipping projects (table not found)')
        return
    cursor = sqlite_conn.cursor()
    cursor.execute('SELECT * FROM project')
    rows = cursor.fetchall()
    cols = [d[0] for d in cursor.description]
    projects = [dict(zip(cols, row)) for row in rows]

    with pg_engine.begin() as conn:
        for p in projects:
            new_id = clean_id(p['id'])
            conn.execute(text("""
                INSERT INTO projects (id, projectNo, name, description, startDate, endDate, status, visibility, createdAt, updatedAt)
                VALUES (:id, :projectNo, :name, :description, :startDate, :endDate, :status, 'public', :createdAt, :updatedAt)
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
            """), {
                'id': new_id,
                'projectNo': p.get('project_no') or f'PRJ-{p["id"]}',
                'name': p.get('project_name') or p.get('name'),
                'description': p.get('product_description') or p.get('notes') or p.get('description'),
                'startDate': p.get('start_date'),
                'endDate': p.get('planned_end_date') or p.get('end_date'),
                'status': 'approved',
                'createdAt': p.get('created_at') or datetime.now(),
                'updatedAt': p.get('updated_at') or datetime.now(),
            })
    print(f'Migrated {len(projects)} projects')


def regenerate_embeddings(pg_engine, ai_service_url: str):
    print('Regenerating embeddings...')
    sources: List[Dict] = []

    title_columns = {
        'customers': 'name',
        'proposals': 'title',
        'quotations': 'quotationNo',
        'products': 'name',
        'suppliers': 'name',
        'projects': 'name',
    }

    with pg_engine.connect() as conn:
        for table, object_type in [
            ('customers', 'customer'),
            ('proposals', 'proposal'),
            ('quotations', 'quotation'),
            ('products', 'product'),
            ('suppliers', 'supplier'),
            ('projects', 'project'),
        ]:
            title_col = title_columns[table]
            try:
                result = conn.execute(text(f'SELECT id, "{title_col}" AS title FROM {table}'))
                for row in result.mappings():
                    sources.append({'source_type': object_type, 'source_id': str(row['id']), 'title': row['title'] or ''})
            except Exception as e:
                print(f'Skipping embeddings for {table}: {e}')
                conn.rollback()

    for source in sources:
        try:
            requests.post(f'{ai_service_url}/rag/delete-by-source', json={
                'source_type': source['source_type'],
                'source_id': source['source_id'],
            })
            content = source['title']
            chunks = [content[i:i+500] for i in range(0, len(content), 400)]
            chunk_docs = [{
                'source_type': source['source_type'],
                'source_id': source['source_id'],
                'document_id': source['source_id'],
                'content': c,
                'permission_snapshot': {'visibility': 'public'},
            } for c in chunks if c]
            requests.post(f'{ai_service_url}/rag/chunks', json={'chunks': chunk_docs})
        except Exception as e:
            print(f"Failed to embed {source}: {e}")
    print(f'Regenerated embeddings for {len(sources)} objects')


def main():
    parser = argparse.ArgumentParser(description='Migrate AI Knowledge Base v1 SQLite to v2 PostgreSQL')
    parser.add_argument('--sqlite', default=os.environ.get('SQLITE_PATH', r'D:\VS_NewP\00_My _Project\AI_ML_Project\08AI-Knowledge-Base\backend\data\app.db'), help='Path to v1 SQLite database')
    parser.add_argument('--pg-url', default=os.environ.get('DATABASE_URL', 'postgresql://aikb:aikb_password@localhost:5432/aikb'), help='PostgreSQL connection URL')
    parser.add_argument('--ai-url', default=os.environ.get('AI_SERVICE_URL', 'http://localhost:8000'), help='AI service base URL')
    args = parser.parse_args()

    sqlite_conn = connect_sqlite(args.sqlite)
    pg_engine = connect_pg(args.pg_url)

    migrate_customers(sqlite_conn, pg_engine)
    migrate_proposals(sqlite_conn, pg_engine)
    migrate_quotations(sqlite_conn, pg_engine)
    migrate_products(sqlite_conn, pg_engine)
    migrate_suppliers(sqlite_conn, pg_engine)
    migrate_projects(sqlite_conn, pg_engine)

    regenerate_embeddings(pg_engine, args.ai_url)

    sqlite_conn.close()
    print('Migration completed')


if __name__ == '__main__':
    main()
