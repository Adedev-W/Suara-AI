# Deploy SuaraAI to EC2

This is the recommended hackathon deployment for the current repository. It
runs the existing Docker Compose stack on one EC2 instance:

```text
Internet → Caddy/HTTPS → frontend → backend → PostgreSQL + pgvector
                                      ↘ AssemblyAI and DeepSeek
```

This is intentionally a single-server deployment. It is simple to operate for
a demo, but it is not highly available and should not be treated as a
production architecture.

## 1. Prepare the EC2 instance

Use an Ubuntu 24.04 64-bit EC2 instance with at least 4 GB RAM. The backend
loads a local embedding model, so very small instances may run out of memory.

Attach an Elastic IP so the address remains stable after a restart. Point an A
record such as `app.example.com` to that Elastic IP.

In the EC2 Security Group, allow:

| Port | Source | Purpose |
| --- | --- | --- |
| `22` | your current IP only | SSH administration |
| `80` | anywhere | HTTP and certificate validation |
| `443` | anywhere | HTTPS application traffic |

Do not open ports `5432`, `8000`, or `8080` to the internet. The Compose file
binds those ports to the EC2 loopback interface for diagnostics only.

## 2. Connect and install Docker

Connect using the EC2 SSH instructions for your AMI. For Ubuntu, the default
user is commonly `ubuntu`:

```bash
ssh -i path/to/key.pem ubuntu@ELASTIC_IP
```

Install Docker Engine and Compose from Docker's official Ubuntu repository:

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo \"$VERSION_CODENAME\")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc" | \
  sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
docker run hello-world
```

## 3. Copy the repository

Clone the repository into the EC2 user home directory:

```bash
git clone YOUR_REPOSITORY_URL
cd SuaraAI
```

The working directory must contain `compose.yaml`, `Caddyfile`, `apps/`, and
`.env.example`.

## 4. Configure production environment variables

Create the server-only environment file:

```bash
cp .env.example .env
nano .env
```

Set these values:

```env
CADDY_DOMAIN=app.example.com

POSTGRES_DB=suaraai
POSTGRES_USER=suaraai
POSTGRES_PASSWORD=use-a-long-unique-password
SUARAAI_DATABASE_URL=postgresql+asyncpg://suaraai:use-a-long-unique-password@database:5432/suaraai

ASSEMBLYAI_API_KEY=your-assemblyai-key
DEEPSEEK_API_KEY=your-deepseek-key
```

Use a password that contains URL-safe characters, or URL-encode special
characters in `SUARAAI_DATABASE_URL`. Never commit this file or paste its
contents into an issue or chat.

## 5. Start the application

Run from the repository root:

```bash
docker compose up -d --build
docker compose ps
```

Check service logs if a container is not healthy:

```bash
docker compose logs --tail=100 caddy
docker compose logs --tail=100 backend
docker compose logs --tail=100 database
```

When DNS points to the server and `CADDY_DOMAIN` matches the hostname, Caddy
obtains and renews the HTTPS certificate automatically. Open:

```text
https://app.example.com
```

Verify the API through the public hostname:

```bash
curl -fsS https://app.example.com/api/v1/health
```

The browser microphone flow should always be tested through HTTPS on EC2.

## 6. Update the deployment

Pull the new revision and rebuild the containers:

```bash
git pull
docker compose up -d --build
docker compose ps
```

The PostgreSQL volume is reused during container recreation. Do not use volume
removal commands during a routine update.

## 7. Backups and cleanup

The database is stored in the `suaraai-postgres` Docker volume. Before an
important demo, create an EC2/EBS snapshot or export the PostgreSQL data using
your normal database backup procedure.

This setup has one server and one database container. If the EC2 instance is
deleted without a snapshot, the local database data is lost. When the
hackathon is over, stop or delete the instance and release unused Elastic IP
resources so they do not continue to incur charges.

## Troubleshooting

### The site is reachable over HTTP but not HTTPS

Confirm that the DNS A record points to the Elastic IP, ports 80 and 443 are
allowed in the Security Group, and `CADDY_DOMAIN` exactly matches the hostname.

### Caddy cannot reach the frontend

Check the dependency chain:

```bash
docker compose ps
docker compose logs --tail=100 frontend backend database
```

### The server runs out of memory

Check EC2 memory usage. The embedding model, PostgreSQL, and the application
run on the same instance. Increase the instance size before attempting to
disable product features.

## Official references

- [EC2 Security Groups](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security-groups.html)
- [EC2 Elastic IP addresses](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html)
- [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
