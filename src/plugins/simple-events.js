export default function(QSL) {
    QSL.allCompleteActions.add(function() {
        document.dispatchEvent(new Event('DOMContentLoaded'));
        window.dispatchEvent(new Event('load'));
    });
}