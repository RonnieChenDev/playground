Deployment

1. Log on the vm via ssh
While creating the instance, keep the key pair to local machine. Save it to /.ssh folder.
Then log in with command below:
`ssh -i C:\Users\ronni\.ssh ubuntu@publicIP`

2. Installing pre-requisites
`curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -`
`sudo apt install -y nodejs`
`sudo apt install -y chromium-browser fonts-liberation libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 libnss3 libxcomposite1 libxdamage1 libxrandr2 xdg-utils`

To check the installation status:
`node --version`
`which chromium-browser || which chromium`

3. Clone the project code to VM using HTTPs protocol

4. Enter the seek-alert folder and create .env file for the project.

5. Enter the seek-alert folder and install dependencies
`npm install`

6. Make the program keep running
```
sudo npm install -g pm2
pm2 start "npx tsx src/index.ts" --name seek-alert --cwd ~/apps/playground/seek-alert
pm2 save
pm2 startup
```
Then execute `pm2 startup`. It will return a command. Copy and paste it and hit enter to run
To check the status: `pm2 status`