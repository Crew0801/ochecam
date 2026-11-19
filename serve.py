"""OcheCam local server.

Serves the app over HTTPS in your home network so the phone browser allows camera access.
Usage:  python serve.py          (port 8443)
        python serve.py 9000     (other port)
Then open the printed https://<PC-IP>:8443 address on the phone (same Wi-Fi) and accept the
certificate warning once ("Erweitert" -> "Weiter zu ...").
"""
import http.server
import os
import shutil
import socket
import ssl
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CERT_DIR = os.path.join(HERE, ".cert")
CERT = os.path.join(CERT_DIR, "cert.pem")
KEY = os.path.join(CERT_DIR, "key.pem")
IPFILE = os.path.join(CERT_DIR, "ip.txt")


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packet is sent
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def find_openssl():
    found = shutil.which("openssl")
    if found:
        return found
    for p in (r"C:\Program Files\Git\usr\bin\openssl.exe", r"C:\Program Files\Git\mingw64\bin\openssl.exe",
              r"C:\Program Files (x86)\Git\usr\bin\openssl.exe"):
        if os.path.exists(p):
            return p
    return None


def make_cert(ip):
    os.makedirs(CERT_DIR, exist_ok=True)
    if os.path.exists(CERT) and os.path.exists(KEY) and os.path.exists(IPFILE):
        with open(IPFILE) as f:
            if f.read().strip() == ip:
                return True
    openssl = find_openssl()
    if openssl:
        cmd = [openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
               "-keyout", KEY, "-out", CERT, "-subj", "/CN=OcheCam",
               "-addext", f"subjectAltName=IP:{ip},IP:127.0.0.1,DNS:localhost"]
        env = dict(os.environ, MSYS_NO_PATHCONV="1")
        if subprocess.run(cmd, capture_output=True, env=env).returncode == 0:
            with open(IPFILE, "w") as f:
                f.write(ip)
            return True
    try:  # fallback: python 'cryptography' package
        import datetime
        import ipaddress
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "OcheCam")])
        now = datetime.datetime.now(datetime.timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
                .not_valid_after(now + datetime.timedelta(days=825))
                .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(ip)),
                                                            x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
                                                            x509.DNSName("localhost")]), critical=False)
                .sign(key, hashes.SHA256()))
        with open(KEY, "wb") as f:
            f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                      serialization.NoEncryption()))
        with open(CERT, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
        with open(IPFILE, "w") as f:
            f.write(ip)
        return True
    except ImportError:
        return False


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".webmanifest": "application/manifest+json", ".js": "text/javascript", ".svg": "image/svg+xml"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
    ip = lan_ip()
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    if make_cert(ip):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        scheme = "https"
    else:
        print("WARNUNG: Kein openssl und kein 'cryptography' gefunden -> nur http, Kamera geht dann nur auf diesem PC.")
        print("         Abhilfe: pip install cryptography")
        scheme = "http"
    print()
    print("  OcheCam läuft.")
    print(f"  Am Handy (gleiches WLAN) öffnen:  {scheme}://{ip}:{port}")
    print(f"  Am PC:                            {scheme}://localhost:{port}")
    if scheme == "https":
        print("  Zertifikatswarnung einmal bestätigen (Erweitert -> Weiter).")
    print("  Beenden mit Strg+C")
    print()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
