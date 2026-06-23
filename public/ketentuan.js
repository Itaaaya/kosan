const items = document.querySelectorAll(".ketentuan-item");

items.forEach(item => {

    const button = item.querySelector(".ketentuan-btn");

    button.addEventListener("click", () => {

        item.classList.toggle("active");

    });

});