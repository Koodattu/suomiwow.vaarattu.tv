"""Exercise the production proxy rules with loopback clients and stub upstreams."""
from pathlib import Path
import subprocess
import tempfile


NGINX = Path(__file__).resolve().parents[1] / "nginx"


def main():
    with tempfile.TemporaryDirectory(prefix="suomiwow-nginx-") as tmp:
        fixture = Path(tmp)
        openssl_config = fixture / "openssl.cnf"
        openssl_config.write_text("[req]\ndistinguished_name=dn\n[dn]\n")
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
            "-config", str(openssl_config), "-subj", "/CN=localhost", "-keyout", str(fixture / "privkey.pem"),
            "-out", str(fixture / "fullchain.pem"),
        ], check=True, capture_output=True)
        conf = (NGINX / "nginx.conf").read_text()
        conf = conf.replace("/etc/letsencrypt/live/suomiwow.vaarattu.tv/", "/fixture/")
        for host, port in [("frontend", 3000), ("backend", 3001), ("backend-worker", 3002)]:
            conf = conf.replace(f"{host}:{port} resolve;", f"127.0.0.1:{port};")
        # The two local bridges model different TCP peers at the TLS listener.
        bridges = ""
        for port, peer in [(8001, "127.0.0.2"), (8002, "127.0.0.3")]:
            bridges += f"""
                server {{ listen {port}; location / {{
                    proxy_bind {peer};
                    proxy_set_header Host suomiwow.vaarattu.tv;
                    proxy_pass https://127.0.0.1:443;
                }} }}
            """
        (fixture / "nginx.conf").write_text("""
            events {}
            http {
                set_real_ip_from 127.0.0.2;
                server {
                    listen 3000; listen 3001; listen 3002;
                    return 200 "$http_x_real_ip|$http_x_forwarded_for|$http_x_forwarded_proto|$server_port";
                }
        """ + conf + bridges + "}")
        checks = """
            nginx -t -c /fixture/nginx.conf
            nginx -c /fixture/nginx.conf
            get() { wget -qO- --header 'CF-Connecting-IP: 192.0.2.42' --header 'X-Forwarded-For: 198.51.100.7' "$1"; }
            status() { wget -SO /dev/null "$1" 2>&1 | awk '/HTTP\\// {print $2; exit}'; }
            for route in /api/raids /api/ccg/studio/media/example /api/foo?text=.env; do
                test "$(get "http://127.0.0.1:8001$route")" = '192.0.2.42|192.0.2.42|https|3001'
                test "$(get "http://127.0.0.1:8002$route")" = '127.0.0.3|127.0.0.3|https|3001'
            done
            test "$(get http://127.0.0.1:8001/api/admin/trigger/example)" = '192.0.2.42|192.0.2.42|https|3002'
            test "$(wget -qO- http://127.0.0.1:8001/api/raids)" = '127.0.0.2|127.0.0.2|https|3001'
            for route in /.env /nested/.env.local /.git/config /wp-login.php /wp-admin/ /cgi-bin/test; do
                test "$(status "http://127.0.0.1$route")" = 404
                test "$(status "http://127.0.0.1:8002$route")" = 404
            done
            for route in /characters/realm/name /.well-known/acme-challenge/fixture /robots.txt /sitemap.xml /_next/static/example.js /guilds/realm/wp-admin; do
                test "$(get "http://127.0.0.1:8002$route")" = '127.0.0.3|127.0.0.3|https|3000'
            done
            test "$(status http://127.0.0.1/characters/realm/name)" = 301
            echo "Client addresses, proxy routes, HTTP redirects and probe rules passed."
        """
        image = (NGINX / "Dockerfile").read_text().splitlines()[0].split()[1]
        subprocess.run([
            "docker", "run", "--rm", "--network", "none", "--entrypoint", "sh",
            "--mount", f"type=bind,source={fixture},target=/fixture,readonly",
            image, "-ec", checks,
        ], check=True, timeout=60)


if __name__ == "__main__":
    main()
