#!/usr/bin/env bash
# pi_setup.sh — Provision a Raspberry Pi as a caption display node
#
# Usage:
#   CONTROLLER_IP=192.168.1.100 DISPLAY_ID=1 bash pi_setup.sh
#
# Tested on: Raspberry Pi OS Bookworm (64-bit), Pi Zero 2 W + Pi 3/4

set -euo pipefail

CONTROLLER_IP="${CONTROLLER_IP:-192.168.1.100}"
DISPLAY_ID="${DISPLAY_ID:-1}"
INSTALL_DIR="/opt/caption-push"

echo "=== Caption Push — Pi Setup ==="
echo "Controller IP : $CONTROLLER_IP"
echo "Display ID    : $DISPLAY_ID"
echo ""

# ---- Disable onboard audio (shares PWM with HUB75 driver) ----
if ! grep -q "dtparam=audio=off" /boot/firmware/config.txt 2>/dev/null && \
   ! grep -q "dtparam=audio=off" /boot/config.txt 2>/dev/null; then
  CONFIG_FILE="/boot/firmware/config.txt"
  [ -f "$CONFIG_FILE" ] || CONFIG_FILE="/boot/config.txt"
  echo "dtparam=audio=off" | sudo tee -a "$CONFIG_FILE"
  echo "[setup] Audio disabled in $CONFIG_FILE (reboot required)"
fi

# ---- System dependencies ----
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends \
  python3-pip python3-dev git \
  libgraphicsmagick++-dev libwebp-dev

# ---- Python dependencies ----
sudo pip3 install --break-system-packages pyzmq Pillow numpy

# ---- Build rpi-rgb-led-matrix ----
if [ ! -d "/opt/rpi-rgb-led-matrix" ]; then
  sudo git clone --depth 1 \
    https://github.com/hzeller/rpi-rgb-led-matrix \
    /opt/rpi-rgb-led-matrix
fi

cd /opt/rpi-rgb-led-matrix
sudo make build-python PYTHON="$(which python3)"
sudo make install-python PYTHON="$(which python3)"

# ---- Install caption-push display code ----
sudo mkdir -p "$INSTALL_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo cp -r "$SCRIPT_DIR/../display"     "$INSTALL_DIR/"
sudo cp -r "$SCRIPT_DIR/../controller"  "$INSTALL_DIR/"  # for shared types if needed

# ---- Write environment config ----
sudo tee "$INSTALL_DIR/display.env" > /dev/null <<EOF
CONTROLLER_IP=$CONTROLLER_IP
DISPLAY_ID=$DISPLAY_ID
EOF

# ---- Install systemd service ----
sudo cp "$SCRIPT_DIR/caption-display.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable caption-display.service

echo ""
echo "=== Setup complete ==="
echo ""
echo "Edit $INSTALL_DIR/display.env to change CONTROLLER_IP or DISPLAY_ID."
echo "Then: sudo systemctl start caption-display.service"
echo ""
echo "IMPORTANT: Reboot for the audio-disable change to take effect."
echo "           sudo reboot"
