#!/usr/bin/env bash

# Set up virtual display for wkhtmltopdf (running as root)
export DISPLAY=:99
Xvfb :99 -screen 0 1024x768x24 -ac > /dev/null 2>&1 &
sleep 2

shutdownHandler() {
   killall node & PID_A=$!
   killall Xvfb & PID_B=$!

   wait $PID_A
   wait $PID_B
   echo "==================================="
   echo "=== WKHTMLTOPDF service stopped ==="
   echo "==================================="

   exit 0
}
trap 'shutdownHandler' TERM

npm start &
echo "============================="
echo "===  wkhtmltopdf started  ==="
echo "============================="

# wait forever
while true; do
   tail -f /dev/null &
   wait ${!}
done
