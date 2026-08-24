from pathlib import Path
import subprocess


WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
FIREWALL_SCRIPT = WORKSPACE_ROOT / "scripts" / "network" / "configure_runtime_api_firewall.sh"


def test_runtime_firewall_dry_run_scopes_api_and_mdns_to_operator_subnet():
    result = subprocess.run(
        [str(FIREWALL_SCRIPT), "--operator-subnet", "192.168.42.0/24"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert "ip saddr 192.168.42.0/24 tcp dport 8765 accept" in result.stdout
    assert "tcp dport 8765 drop" in result.stdout
    assert "ip saddr 192.168.42.0/24 udp dport 5353 accept" in result.stdout
    assert "udp dport 5353 drop" in result.stdout
    assert "Dry run only" in result.stdout
    source = FIREWALL_SCRIPT.read_text(encoding="utf-8")
    assert "/etc/nftables.d/iii-operator.nft" in source
    assert 'include \"/etc/nftables.d/*.nft\"' in source


def test_runtime_firewall_rejects_missing_or_malformed_subnet():
    for args in ([], ["--operator-subnet", "0.0.0.0/0"], ["--operator-subnet", "operator-lan"]):
        result = subprocess.run([str(FIREWALL_SCRIPT), *args], check=False, capture_output=True, text=True)
        assert result.returncode == 2
