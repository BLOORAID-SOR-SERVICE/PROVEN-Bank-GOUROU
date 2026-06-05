(function() {
    var forms = document.querySelectorAll('.login-form');
    forms.forEach(function(form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            var username = form.querySelector('[name="username"]').value.trim();
            var password = form.querySelector('[name="password"]').value.trim();
            if (!username || !password) return;
            fetch('/api/client/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username, password: password })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.client) {
                    localStorage.setItem('client', JSON.stringify(data.client));
                    window.location.href = '/profile/';
                } else {
                    alert(data.error === 'Account not activated' ? 'Your account has not been activated yet.' : 'Invalid username or password');
                }
            }).catch(function() {
                alert('Connection error');
            });
        });
    });
})();
