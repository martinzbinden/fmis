-- Modul «Tiere» heisst «Tiergruppen»: der Reiter «Tiere» in Milchkühe und
-- Milchschafe ist etwas anderes (Liste der Tiere), das Modul verwaltet die Gruppen.

update modules set title = 'Tiergruppen' where key = 'tiere' and title = 'Tiere';
