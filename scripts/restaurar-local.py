#!/usr/bin/env python3
"""Carga una copia de seguridad de la app (el .json de "Copia de seguridad → Exportar")
en la base de datos LOCAL (Supabase en Docker), tal cual: clientes, pagos, entregas,
pedidos, menús, menú del día, productos, stock, movimientos y cadetes, con sus mismos ids.

Reemplaza lo que haya en el negocio local de esa cuenta. Nunca toca producción:
se conecta solo a la base local (127.0.0.1:54322).

Uso:
    python3 scripts/restaurar-local.py ruta/al/backup.json [email-de-la-cuenta-local]

Si no se pasa el email, usa el primero de supabase/usuarios-locales.txt.
"""
import json, os, re, subprocess, sys

DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
# en orden, para respetar las referencias entre tablas
TABLAS = ['cadetes', 'productos', 'menus', 'menu_productos', 'clientes', 'pagos', 'entregas',
          'rutas', 'comandas', 'movimientos', 'stock', 'carta_dia']


def psql(sql, *extra):
    r = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-At', *extra], input=sql, text=True,
                       capture_output=True, env={**os.environ, 'LC_ALL': 'C'})
    if r.returncode:
        sys.exit('Error en la base local:\n' + r.stderr.strip())
    return r.stdout.strip()


def lit(s):
    return "'" + str(s).replace("'", "''") + "'"


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    copia = json.load(open(sys.argv[1], encoding='utf-8'))
    if not isinstance(copia, dict) or not isinstance(copia.get('clientes'), list):
        sys.exit('Ese archivo no parece una copia de seguridad de la app.')
    email = sys.argv[2] if len(sys.argv) > 2 else None
    if not email:
        notas = os.path.join(os.path.dirname(__file__), '..', 'supabase', 'usuarios-locales.txt')
        m = re.search(r'email:\s*(\S+)', open(notas, encoding='utf-8').read()) if os.path.exists(notas) else None
        email = m.group(1) if m else sys.exit('Pasá el email de la cuenta local como segundo argumento.')

    neg = psql(f"""select coalesce((select m.negocio_id from miembros m join auth.users u on u.id = m.auth_id where lower(u.email) = lower({lit(email)})),
                                   (select id from auth.users where lower(email) = lower({lit(email)})))""")
    if not neg:
        sys.exit(f'No existe la cuenta {email} en la base local.')

    tablas = [t for t in TABLAS if isinstance(copia.get(t), list)]
    existentes = set(psql("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'").split('\n'))
    tablas = [t for t in tablas if t in existentes]
    tag = '$bk$'
    sql = ['begin;']
    todas = TABLAS + ['entregas_log', 'negocio_config']
    for t in todas:
        if t in existentes: sql.append(f'alter table {t} disable trigger user;')
    # se reemplaza lo que había en el negocio local
    for t in reversed(todas):
        if t in existentes: sql.append(f'delete from {t} where user_id = {lit(neg)};')
    for t in tablas:
        if not copia[t]: continue
        filas = json.dumps(copia[t], ensure_ascii=False)
        if tag in filas: sys.exit('El archivo tiene un texto que no se puede cargar.')
        # solo las columnas que trae el archivo: las que agregaron migraciones más nuevas toman su valor por defecto
        cols_tabla = psql(f"select column_name from information_schema.columns where table_schema = 'public' and table_name = '{t}' order by ordinal_position").split('\n')
        claves = set().union(*(r.keys() for r in copia[t])) | {'user_id'}
        cols = [c for c in cols_tabla if c in claves]
        if 'user_id' not in cols_tabla: cols = [c for c in cols if c != 'user_id']
        sel = ', '.join(f"{lit(neg)}::uuid" if c == 'user_id' else f'r.{c}' for c in cols)
        sql.append(f"""insert into {t} ({', '.join(cols)})
  select {sel} from jsonb_populate_recordset(null::{t}, {tag}{filas}{tag}::jsonb) r on conflict do nothing;""")
    neg_cfg = copia.get('negocio') or {}
    if 'negocio_config' in existentes:
        sql.append(f"""insert into negocio_config (user_id, nombre, cocina_direccion, cocina_lat, cocina_lng, alerta_viandas)
  values ({lit(neg)}, {lit(neg_cfg.get('nombre') or 'Mi Vianda')}, {lit(neg_cfg.get('cocinaDireccion') or '')},
          {neg_cfg.get('cocinaLat') if neg_cfg.get('cocinaLat') is not None else 'null'}, {neg_cfg.get('cocinaLng') if neg_cfg.get('cocinaLng') is not None else 'null'},
          {int(neg_cfg.get('alertaViandas') or 3)})
  on conflict (user_id) do update set nombre = excluded.nombre, cocina_direccion = excluded.cocina_direccion,
    cocina_lat = excluded.cocina_lat, cocina_lng = excluded.cocina_lng, alerta_viandas = excluded.alerta_viandas;""")
    for t in todas:
        if t in existentes: sql.append(f'alter table {t} enable trigger user;')
    sql.append('commit;')
    psql('\n'.join(sql))

    print(f'Listo: copia cargada en la base local, negocio de {email}.')
    for t in tablas:
        n = psql(f"select count(*) from {t} where user_id = {lit(neg)}")
        print(f'  {t:15} {len(copia[t]):5} en el archivo · {n:>5} en la base local')
    print('Recargá la app (http://127.0.0.1:5500) para verla.')


if __name__ == '__main__':
    main()
