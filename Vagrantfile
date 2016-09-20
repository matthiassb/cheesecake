Vagrant.configure("2") do |config|
  config.vm.box = "ubuntu/trusty64"
  config.vm.hostname = "cheesecake.box"
  config.vm.network "forwarded_port", guest: 9090, host: 9090
  config.vm.provision "shell", path: "provision.sh"
  config.vm.boot_timeout = 600
  config.vm.provider :virtualbox do |vb|
    vb.customize ["modifyvm", :id, "--nictype1", "Am79C973"]
    vb.customize ["modifyvm", :id, "--hwvirtex", "on"]
    vb.memory = "4096"
    v.cpus = "2"
  end
end
