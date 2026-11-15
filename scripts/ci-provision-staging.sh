#!/bin/bash
# ============================================================
# Staging Provisioning — runs ON the VPS via SSH from the
# provision-staging workflow. Idempotent. Never touches the
# production app dir, PM2 process, MySQL schema, or env.
#
# Creates: dedicated app dir, shared data dir, staging MySQL
# database + least-privilege user, .env with stubbed Ryne,
# PM2 stub + app placeholders, nginx vhost (basic auth), TLS.
#
# Required env (from workflow, never logged):
#   STAGING_HOSTNAME      public hostname (e.g. x.y.z.w.sslip.io)
#   STAGING_DB_PASSWORD   generated per-run if unset
#   STAGING_DB_ROOT_PW    MySQL root password (repo secret)
#   STAGING_DEPLOY_PUBKEY public key to authorize for deploys
#   STAGING_HTPASSWD      htpasswd-format basic-auth line
#   CERTBOT_EMAIL         email for Let's Encrypt registration
# ============================================================
set -euo pipefail

APP_DIR=/opt/sop-ai-staging
SHARED_DIR=/opt/sop-ai-staging-shared
PM2_NAME=sop-app-staging
STUB_NAME=ryne-stub
APP_PORT=5011
STUB_PORT=5099
DB_NAME=sop_ai_staging
DB_USER=sop_staging
NGINX_AVAIL=/etc/nginx/sites-available/sop-staging
NGINX_ENABLED=/etc/nginx/sites-enabled/sop-staging
HTPASSWD_FILE=/etc/nginx/.htpasswd-sop-staging

: "${STAGING_HOSTNAME:?required}"
: "${STAGING_HTPASSWD:?required}"
: "${STAGING_DEPLOY_PUBKEY:?required}"
: "${CERTBOT_EMAIL:?required}"
: "${STAGING_DB_ROOT_PW:?required}"
STAGING_DB_PASSWORD="${STAGING_DB_PASSWORD:-$(openssl rand -hex 24)}"

echo "=== Provisioning staging ($STAGING_HOSTNAME) ==="

# --- 1. Directories -------------------------------------------------------
mkdir -p "$APP_DIR" "$SHARED_DIR"/{logs,uploads,backups,baselines}
chmod 700 "$APP_DIR"
chmod 755 "$SHARED_DIR" "$SHARED_DIR"/{logs,uploads,backups,baselines}

# --- 2. Dedicated deploy key ----------------------------------------------
mkdir -p /root/.ssh && chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
if ! grep -qF "$STAGING_DEPLOY_PUBKEY" /root/.ssh/authorized_keys; then
  echo "$STAGING_DEPLOY_PUBKEY" >> /root/.ssh/authorized_keys
fi

# --- 3. MySQL database + least-privilege user ------------------------------
mysql -u root -p"$STAGING_DB_ROOT_PW" <<SQL
CREATE DATABASE IF NOT EXISTS $DB_NAME CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$STAGING_DB_PASSWORD';
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$STAGING_DB_PASSWORD';
GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'127.0.0.1';
GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL

# --- 4. Staging .env (mode 600 — secrets never logged) ---------------------
cat > "$APP_DIR/.env" <<ENV
SOP_DB_HOST=127.0.0.1
SOP_DB_PORT=3306
SOP_DB_USER=$DB_USER
SOP_DB_PASSWORD=$STAGING_DB_PASSWORD
SOP_DB_NAME=$DB_NAME
RYNE_API_BASE_URL=http://127.0.0.1:$STUB_PORT
RYNE_API_KEY=staging-stub-key
RYNE_PAID_CALLS_ENABLED=1
RYNE_UNVERIFIED_PRICE_CEILING_USD=0.02
RYNE_DAILY_BUDGET_USD=5
ENV
chmod 600 "$APP_DIR/.env"

# --- 5. Basic auth file ----------------------------------------------------
printf '%s\n' "$STAGING_HTPASSWD" > "$HTPASSWD_FILE"
chmod 640 "$HTPASSWD_FILE"
chown root:www-data "$HTPASSWD_FILE" 2>/dev/null || true

# --- 6. nginx vhost — HTTP only first (certbot upgrades to 443) ------------
cat > "$NGINX_AVAIL" <<NGINX
server {
    listen 80;
    server_name $STAGING_HOSTNAME;

    auth_basic "staging";
    auth_basic_user_file $HTPASSWD_FILE;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 25m;
    }
}
NGINX
ln -sf "$NGINX_AVAIL" "$NGINX_ENABLED"
nginx -t
systemctl reload nginx

# --- 7. TLS certificate (idempotent) ---------------------------------------
if [ ! -d "/etc/letsencrypt/live/$STAGING_HOSTNAME" ]; then
  certbot --nginx -d "$STAGING_HOSTNAME" --non-interactive --agree-tos \
    -m "$CERTBOT_EMAIL" --redirect
else
  certbot --nginx -d "$STAGING_HOSTNAME" --non-interactive --agree-tos \
    -m "$CERTBOT_EMAIL" --redirect || true
fi
nginx -t
systemctl reload nginx

# --- 8. PM2 note -----------------------------------------------------------
# No code exists at provision time. The deploy flow creates the
# sop-app-staging and ryne-stub PM2 processes on first deploy.

echo "=== Staging provisioning complete ==="
echo "host=$STAGING_HOSTNAME app_port=$APP_PORT stub_port=$STUB_PORT db=$DB_NAME pm2=$PM2_NAME"
